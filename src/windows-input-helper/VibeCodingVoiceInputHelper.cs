using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace VibeCodingVoice.InputHelper
{
    internal static class Program
    {
        private const int WmHotkey = 0x0312;
        private const int WmTimer = 0x0113;
        private const int VkEscape = 0x1b;
        private const int VkApps = 0x5d;
        private const int GwlExstyle = -20;
        private const long WsExNoactivate = 0x08000000L;

        private const uint ModAlt = 0x0001;
        private const uint ModControl = 0x0002;
        private const uint ModShift = 0x0004;
        private const uint ModWin = 0x0008;
        private const uint ModNoRepeat = 0x4000;

        private const int RecordHotkeyId = 1;
        private const int SendHotkeyId = 2;
        private const int UndoHotkeyId = 3;
        private const int TranslateHotkeyId = 4;
        private const int MenuHotkeyId = 5;

        private static readonly List<int> RegisteredHotkeyIds = new List<int>();
        private static MonitorOptions monitorOptions;
        private static int activeRecordKey = -1;
        private static bool escapeWasDown;

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                if (HasFlag(args, "--self-test"))
                {
                    Console.WriteLine("{\"ok\":true,\"helper\":\"VibeCodingVoiceInputHelper\"}");
                    return 0;
                }

                string focusTarget = GetOption(args, "--focus-window");
                if (!String.IsNullOrWhiteSpace(focusTarget))
                {
                    return FocusWindow(focusTarget);
                }

                string textBase64 = GetOption(args, "--inject-text-base64");
                string injectionMode = GetOption(args, "--mode");
                if (!String.IsNullOrWhiteSpace(textBase64) ||
                    String.Equals(injectionMode, "enter_only", StringComparison.OrdinalIgnoreCase))
                {
                    return InjectText(textBase64, injectionMode, GetOption(args, "--target-window"));
                }

                string keySpec = GetOption(args, "--inject-key");
                if (!String.IsNullOrWhiteSpace(keySpec))
                {
                    return InjectKey(keySpec);
                }

                if (HasFlag(args, "--monitor"))
                {
                    monitorOptions = MonitorOptions.Parse(args);
                    return RunMonitor();
                }

                Console.Error.WriteLine(
                    "usage: --monitor | --focus-window <hwnd> | --inject-text-base64 <text> | --inject-key <key> | --self-test"
                );
                return 2;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.Message);
                return 1;
            }
        }

        private static int RunMonitor()
        {
            HashSet<string> registeredCombinations = new HashSet<string>(StringComparer.Ordinal);
            RegisterConfiguredHotkey(RecordHotkeyId, monitorOptions.Record, registeredCombinations);
            RegisterConfiguredHotkey(SendHotkeyId, monitorOptions.Send, registeredCombinations);
            RegisterConfiguredHotkey(UndoHotkeyId, monitorOptions.Undo, registeredCombinations);
            RegisterConfiguredHotkey(TranslateHotkeyId, monitorOptions.Translate, registeredCombinations);
            if (monitorOptions.SuppressMenu &&
                RegisterHotKey(IntPtr.Zero, MenuHotkeyId, ModNoRepeat, VkApps))
            {
                RegisteredHotkeyIds.Add(MenuHotkeyId);
            }

            UIntPtr timerId = SetTimer(IntPtr.Zero, UIntPtr.Zero, 15, IntPtr.Zero);
            if (timerId == UIntPtr.Zero)
            {
                UnregisterConfiguredHotkeys();
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            Console.Error.WriteLine("ready");
            Console.Error.Flush();

            try
            {
                Message message;
                while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
                {
                    if (message.message == WmHotkey)
                    {
                        HandleRegisteredHotkey(message.wParam.ToInt32());
                    }
                    else if (message.message == WmTimer)
                    {
                        PollReleaseAndEscape();
                    }
                    TranslateMessage(ref message);
                    DispatchMessage(ref message);
                }
            }
            finally
            {
                KillTimer(IntPtr.Zero, timerId);
                UnregisterConfiguredHotkeys();
            }

            return 0;
        }

        private static void RegisterConfiguredHotkey(int id, Hotkey hotkey, HashSet<string> combinations)
        {
            if (hotkey.VirtualKey <= 0)
            {
                return;
            }
            uint modifiers = ToRegisterHotkeyModifiers(hotkey.Modifiers) | ModNoRepeat;
            string combination = modifiers.ToString(CultureInfo.InvariantCulture) + ":" +
                hotkey.VirtualKey.ToString(CultureInfo.InvariantCulture);
            if (!combinations.Add(combination))
            {
                return;
            }
            if (!RegisterHotKey(IntPtr.Zero, id, modifiers, hotkey.VirtualKey))
            {
                UnregisterConfiguredHotkeys();
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Could not register global hotkey " + hotkey.VirtualKey.ToString(CultureInfo.InvariantCulture)
                );
            }
            RegisteredHotkeyIds.Add(id);
        }

        private static uint ToRegisterHotkeyModifiers(int modifiers)
        {
            uint result = 0;
            if ((modifiers & 1) != 0)
            {
                result |= ModShift;
            }
            if ((modifiers & 2) != 0)
            {
                result |= ModControl;
            }
            if ((modifiers & 4) != 0)
            {
                result |= ModAlt;
            }
            if ((modifiers & 8) != 0)
            {
                result |= ModWin;
            }
            return result;
        }

        private static void HandleRegisteredHotkey(int id)
        {
            switch (id)
            {
                case RecordHotkeyId:
                    if (activeRecordKey <= 0)
                    {
                        activeRecordKey = monitorOptions.Record.VirtualKey;
                        Emit("{\"type\":\"record_start\"}");
                    }
                    break;
                case SendHotkeyId:
                    Emit("{\"type\":\"action_send\"}");
                    break;
                case UndoHotkeyId:
                    Emit("{\"type\":\"action_undo\"}");
                    break;
                case TranslateHotkeyId:
                    Emit("{\"type\":\"toggle_english_output\"}");
                    break;
                case MenuHotkeyId:
                    break;
            }
        }

        private static void PollReleaseAndEscape()
        {
            if (activeRecordKey > 0 && (GetAsyncKeyState(activeRecordKey) & 0x8000) == 0)
            {
                activeRecordKey = -1;
                Emit("{\"type\":\"record_stop\"}");
            }
            bool escapeDown = (GetAsyncKeyState(VkEscape) & 0x8000) != 0;
            if (escapeDown && !escapeWasDown)
            {
                Emit("{\"type\":\"cancel_active_dictation\",\"origin\":\"escape\"}");
            }
            escapeWasDown = escapeDown;
        }

        private static void UnregisterConfiguredHotkeys()
        {
            foreach (int id in RegisteredHotkeyIds)
            {
                UnregisterHotKey(IntPtr.Zero, id);
            }
            RegisteredHotkeyIds.Clear();
        }

        private static void Emit(string json)
        {
            Console.WriteLine(json);
            Console.Out.Flush();
        }

        private static int FocusWindow(string value)
        {
            IntPtr target = ParseWindowHandle(value);
            if (target == IntPtr.Zero || !IsWindow(target))
            {
                throw new ArgumentException("focus target is not a valid window");
            }

            FocusResult result = FocusWindowCore(target);
            Console.WriteLine(
                "{\"ok\":" + (result.Ok ? "true" : "false") +
                ",\"foreground\":" + result.Foreground.ToInt64().ToString(CultureInfo.InvariantCulture) +
                ",\"previous\":" + result.Previous.ToInt64().ToString(CultureInfo.InvariantCulture) +
                ",\"target\":" + target.ToInt64().ToString(CultureInfo.InvariantCulture) + "}"
            );
            return result.Ok ? 0 : 1;
        }

        private static FocusResult FocusWindowCore(IntPtr target)
        {
            IntPtr previous = GetForegroundWindow();
            IntPtr style = GetWindowLongPtr(target, GwlExstyle);
            long styleValue = style.ToInt64();
            if ((styleValue & WsExNoactivate) != 0)
            {
                SetWindowLongPtr(target, GwlExstyle, new IntPtr(styleValue & ~WsExNoactivate));
            }

            uint currentThread = GetCurrentThreadId();
            uint ignoredProcess;
            uint foregroundThread = previous == IntPtr.Zero
                ? 0
                : GetWindowThreadProcessId(previous, out ignoredProcess);
            bool attached = false;
            if (foregroundThread != 0 && foregroundThread != currentThread)
            {
                attached = AttachThreadInput(currentThread, foregroundThread, true);
            }

            try
            {
                BringWindowToTop(target);
                SetForegroundWindow(target);
                SetFocus(target);
            }
            finally
            {
                if (attached)
                {
                    AttachThreadInput(currentThread, foregroundThread, false);
                }
            }

            Thread.Sleep(60);
            IntPtr actual = GetForegroundWindow();
            return new FocusResult { Ok = actual == target, Foreground = actual, Previous = previous };
        }

        private static IntPtr ParseWindowHandle(string value)
        {
            long rawHandle;
            string normalized = String.IsNullOrWhiteSpace(value) ? "" : value.Trim();
            if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                rawHandle = Int64.Parse(normalized.Substring(2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
            }
            else
            {
                rawHandle = Int64.Parse(normalized, CultureInfo.InvariantCulture);
            }
            return new IntPtr(rawHandle);
        }

        private static int InjectText(string textBase64, string mode, string targetWindow)
        {
            string normalizedMode = String.IsNullOrWhiteSpace(mode) ? "type_only" : mode.Trim().ToLowerInvariant();
            if (normalizedMode != "type_only" && normalizedMode != "type_and_enter" && normalizedMode != "enter_only")
            {
                throw new ArgumentException("unsupported injection mode: " + mode);
            }

            if (normalizedMode == "enter_only")
            {
                SendKeys.SendWait("{ENTER}");
                return 0;
            }
            if (String.IsNullOrWhiteSpace(textBase64))
            {
                return 0;
            }

            if (!String.IsNullOrWhiteSpace(targetWindow))
            {
                IntPtr target = ParseWindowHandle(targetWindow);
                if (target != IntPtr.Zero && IsWindow(target))
                {
                    FocusWindowCore(target);
                }
            }

            string text = Encoding.UTF8.GetString(Convert.FromBase64String(textBase64));
            bool restoreClipboard = false;
            string previousClipboard = null;
            try
            {
                if (Clipboard.ContainsText())
                {
                    previousClipboard = Clipboard.GetText(TextDataFormat.UnicodeText);
                    restoreClipboard = true;
                }
            }
            catch
            {
                restoreClipboard = false;
            }

            Clipboard.SetText(text);
            Thread.Sleep(60);
            SendKeys.SendWait("^v");
            if (normalizedMode == "type_and_enter")
            {
                Thread.Sleep(200);
                SendKeys.SendWait("{ENTER}");
            }
            Thread.Sleep(180);

            if (restoreClipboard)
            {
                try
                {
                    Clipboard.SetText(previousClipboard ?? String.Empty);
                }
                catch
                {
                    // Clipboard restoration is best effort.
                }
            }
            return 0;
        }

        private static int InjectKey(string keySpec)
        {
            string[] parts = keySpec.Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
            List<byte> modifiers = new List<byte>();
            byte mainKey = 0;
            foreach (string rawPart in parts)
            {
                string part = rawPart.Trim().ToLowerInvariant();
                byte modifier = ResolveModifierKey(part);
                if (modifier != 0 && mainKey == 0)
                {
                    modifiers.Add(modifier);
                }
                else
                {
                    mainKey = ResolveKey(part);
                }
            }
            if (mainKey == 0)
            {
                throw new ArgumentException("key combination needs a non-modifier key");
            }

            foreach (byte modifier in modifiers)
            {
                keybd_event(modifier, 0, 0, UIntPtr.Zero);
            }
            Thread.Sleep(20);
            keybd_event(mainKey, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);
            keybd_event(mainKey, 0, 2, UIntPtr.Zero);
            Thread.Sleep(20);
            for (int index = modifiers.Count - 1; index >= 0; index -= 1)
            {
                keybd_event(modifiers[index], 0, 2, UIntPtr.Zero);
            }
            return 0;
        }

        private static byte ResolveModifierKey(string name)
        {
            switch (name)
            {
                case "ctrl":
                case "control": return 0x11;
                case "shift": return 0x10;
                case "alt": return 0x12;
                case "win":
                case "meta": return 0x5b;
                default: return 0;
            }
        }

        private static byte ResolveKey(string name)
        {
            Dictionary<string, byte> namedKeys = new Dictionary<string, byte>(StringComparer.OrdinalIgnoreCase)
            {
                { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 },
                { "enter", 0x0d }, { "escape", 0x1b }, { "tab", 0x09 }, { "space", 0x20 },
                { "backspace", 0x08 }, { "delete", 0x2e }, { "home", 0x24 }, { "end", 0x23 },
                { "pageup", 0x21 }, { "pagedown", 0x22 }, { "menu", 0x5d },
                { "volume_up", 0xaf }, { "volume_down", 0xae }
            };
            byte key;
            if (namedKeys.TryGetValue(name, out key))
            {
                return key;
            }
            if (name.Length >= 2 && name[0] == 'f')
            {
                int functionNumber;
                if (Int32.TryParse(name.Substring(1), out functionNumber) && functionNumber >= 1 && functionNumber <= 24)
                {
                    return (byte)(0x70 + functionNumber - 1);
                }
            }
            if (name.Length == 1 && Char.IsLetterOrDigit(name[0]))
            {
                return (byte)Char.ToUpperInvariant(name[0]);
            }
            throw new ArgumentException("unknown key name: " + name);
        }

        private static bool HasFlag(string[] args, string name)
        {
            foreach (string value in args)
            {
                if (String.Equals(value, name, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static string GetOption(string[] args, string name)
        {
            for (int index = 0; index + 1 < args.Length; index += 1)
            {
                if (String.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
                {
                    return args[index + 1];
                }
            }
            return null;
        }

        private sealed class MonitorOptions
        {
            internal Hotkey Record;
            internal Hotkey Send;
            internal Hotkey Undo;
            internal Hotkey Translate;
            internal bool SuppressMenu;

            internal static MonitorOptions Parse(string[] args)
            {
                return new MonitorOptions
                {
                    Record = Hotkey.Parse(args, "record"),
                    Send = Hotkey.Parse(args, "send"),
                    Undo = Hotkey.Parse(args, "undo"),
                    Translate = Hotkey.Parse(args, "translate"),
                    SuppressMenu = HasFlag(args, "--suppress-menu")
                };
            }
        }

        private struct Hotkey
        {
            internal int VirtualKey;
            internal int Modifiers;

            internal static Hotkey Parse(string[] args, string name)
            {
                int key;
                int modifiers;
                Int32.TryParse(GetOption(args, "--" + name + "-vk"), out key);
                Int32.TryParse(GetOption(args, "--" + name + "-modifiers"), out modifiers);
                return new Hotkey { VirtualKey = key, Modifiers = modifiers };
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Message
        {
            internal IntPtr hwnd;
            internal uint message;
            internal IntPtr wParam;
            internal IntPtr lParam;
            internal uint time;
            internal int pointX;
            internal int pointY;
        }

        private struct FocusResult
        {
            internal bool Ok;
            internal IntPtr Foreground;
            internal IntPtr Previous;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetMessage(out Message message, IntPtr window, uint minimum, uint maximum);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref Message message);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref Message message);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, int virtualKey);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnregisterHotKey(IntPtr window, int id);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int virtualKey);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern UIntPtr SetTimer(IntPtr window, UIntPtr eventId, uint intervalMs, IntPtr callback);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool KillTimer(IntPtr window, UIntPtr eventId);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindow(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool BringWindowToTop(IntPtr window);

        [DllImport("user32.dll")]
        private static extern IntPtr SetFocus(IntPtr window);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AttachThreadInput(uint attachThread, uint attachToThread, bool attach);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
        private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
        private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
    }
}
