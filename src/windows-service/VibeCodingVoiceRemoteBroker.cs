using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace VibeCodingVoice.RemoteBroker
{
    internal static class Program
    {
        private const string ServiceNameValue = "VibeCodingVoiceRemoteBroker";

        private static int Main(string[] args)
        {
            if (args.Length == 1 && String.Equals(args[0], "--self-test", StringComparison.OrdinalIgnoreCase))
            {
                return RemoteBrokerService.RunSelfTest() ? 0 : 1;
            }

            ServiceBase.Run(new RemoteBrokerService(ServiceNameValue));
            return 0;
        }
    }

    internal sealed class BrokerRequest
    {
        public int version { get; set; }
        public string action { get; set; }
        public string pipeName { get; set; }
        public int ownerPid { get; set; }
        public string interfaceName { get; set; }
        public string deviceAddress { get; set; }
        public string hidDeviceMatch { get; set; }
        public string adapterMatch { get; set; }
        public bool allowInterfaceSwitch { get; set; }
        public string instanceId { get; set; }
    }

    internal sealed class BrokerResponse
    {
        public bool ok { get; set; }
        public string error { get; set; }
        public int? pid { get; set; }
        public int? exitCode { get; set; }
        public string output { get; set; }

        public static BrokerResponse Success()
        {
            return new BrokerResponse { ok = true };
        }

        public static BrokerResponse Failure(string message)
        {
            return new BrokerResponse { ok = false, error = message };
        }
    }

    internal sealed class CaptureProcess
    {
        public int OwnerPid { get; set; }
        public Process Process { get; set; }
    }

    internal sealed class RemoteBrokerService : ServiceBase
    {
        private const string PipeName = "VibeCodingVoice.RemoteBroker.v1";
        private const int MaxRequestCharacters = 16384;
        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;

        private static readonly Regex PipeNamePattern = new Regex(
            @"^vibecoding-xiaomi-[0-9]+-[0-9]+-[a-f0-9]+$",
            RegexOptions.CultureInvariant | RegexOptions.IgnoreCase
        );
        private static readonly Regex InterfacePattern = new Regex(
            @"^\\\\\.\\USBPcap[0-9]+$",
            RegexOptions.CultureInvariant | RegexOptions.IgnoreCase
        );
        private static readonly Regex DeviceAddressPattern = new Regex(
            @"^[0-9]{1,3}$",
            RegexOptions.CultureInvariant
        );
        private static readonly Regex HidMatchPattern = new Regex(
            @"^[A-Za-z0-9_&-]{0,128}$",
            RegexOptions.CultureInvariant
        );

        private readonly ManualResetEvent stopping = new ManualResetEvent(false);
        private readonly object captureLock = new object();
        private readonly List<CaptureProcess> captures = new List<CaptureProcess>();
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
        private Thread listenerThread;
        private IntPtr captureJob = IntPtr.Zero;

        private readonly string appRoot;
        private readonly string allowedClientPath;
        private readonly string helperPath;
        private readonly string usbPcapPath;
        private readonly string logDirectory;
        private readonly string serviceLogPath;

        public RemoteBrokerService(string serviceName)
        {
            ServiceName = serviceName;
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;

            string brokerDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar
            );
            DirectoryInfo resourcesDirectory = Directory.GetParent(brokerDirectory);
            DirectoryInfo installDirectory = resourcesDirectory == null ? null : resourcesDirectory.Parent;
            appRoot = installDirectory == null ? String.Empty : installDirectory.FullName;
            allowedClientPath = Path.Combine(appRoot, "VibeCoding Voice.exe");
            helperPath = resourcesDirectory == null
                ? String.Empty
                : Path.Combine(
                    resourcesDirectory.FullName,
                    "app.asar.unpacked",
                    "scripts",
                    "windows",
                    "xiaomi-usbpcap-pipe.ps1"
                );
            usbPcapPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "USBPcap",
                "USBPcapCMD.exe"
            );
            logDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "VibeCoding Voice",
                "logs"
            );
            serviceLogPath = Path.Combine(logDirectory, "remote-broker.log");
        }

        public static bool RunSelfTest()
        {
            try
            {
                RemoteBrokerService service = new RemoteBrokerService("VibeCodingVoiceRemoteBrokerSelfTest");
                return Directory.Exists(service.appRoot) && File.Exists(service.helperPath);
            }
            catch
            {
                return false;
            }
        }

        protected override void OnStart(string[] args)
        {
            Directory.CreateDirectory(logDirectory);
            HardenOwnServiceImagePath();
            captureJob = CreateKillOnCloseJob();
            listenerThread = new Thread(ListenLoop);
            listenerThread.IsBackground = true;
            listenerThread.Name = "VibeCoding Voice remote broker";
            listenerThread.Start();
            Log("service started");
        }

        protected override void OnStop()
        {
            StopBroker();
        }

        protected override void OnShutdown()
        {
            StopBroker();
            base.OnShutdown();
        }

        private void StopBroker()
        {
            stopping.Set();
            WakeListener();
            if (listenerThread != null && listenerThread.IsAlive)
            {
                listenerThread.Join(3000);
            }
            StopAllCaptures();
            if (captureJob != IntPtr.Zero)
            {
                CloseHandle(captureJob);
                captureJob = IntPtr.Zero;
            }
            Log("service stopped");
        }

        private void ListenLoop()
        {
            while (!stopping.WaitOne(0))
            {
                NamedPipeServerStream pipe = null;
                try
                {
                    pipe = CreatePipeServer();
                    pipe.WaitForConnection();
                    if (stopping.WaitOne(0))
                    {
                        pipe.Dispose();
                        break;
                    }
                    NamedPipeServerStream connectedPipe = pipe;
                    pipe = null;
                    ThreadPool.QueueUserWorkItem(delegate { HandleClient(connectedPipe); });
                }
                catch (Exception error)
                {
                    if (!stopping.WaitOne(0))
                    {
                        Log("listener error: " + error.Message);
                        Thread.Sleep(500);
                    }
                }
                finally
                {
                    if (pipe != null)
                    {
                        pipe.Dispose();
                    }
                }
            }
        }

        private static NamedPipeServerStream CreatePipeServer()
        {
            PipeSecurity security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
                PipeAccessRights.FullControl,
                AccessControlType.Allow
            ));
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null),
                PipeAccessRights.ReadWrite,
                AccessControlType.Allow
            ));

            return new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                5,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous,
                4096,
                4096,
                security
            );
        }

        private void HandleClient(NamedPipeServerStream pipe)
        {
            using (pipe)
            {
                try
                {
                    uint clientPidValue;
                    if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out clientPidValue) || clientPidValue == 0)
                    {
                        WriteResponse(pipe, BrokerResponse.Failure("Only local desktop clients are allowed."));
                        return;
                    }

                    int clientPid = checked((int)clientPidValue);
                    if (!IsAllowedClient(clientPid))
                    {
                        Log("rejected client pid " + clientPid);
                        WriteResponse(pipe, BrokerResponse.Failure("The requesting program is not an installed VibeCoding Voice client."));
                        return;
                    }

                    string requestLine = ReadLimitedLine(pipe);
                    BrokerRequest request = serializer.Deserialize<BrokerRequest>(requestLine);
                    BrokerResponse response = Dispatch(request, clientPid);
                    WriteResponse(pipe, response);
                }
                catch (Exception error)
                {
                    Log("request error: " + error.Message);
                    try
                    {
                        WriteResponse(pipe, BrokerResponse.Failure(error.Message));
                    }
                    catch
                    {
                        // The client already disconnected.
                    }
                }
            }
        }

        private BrokerResponse Dispatch(BrokerRequest request, int clientPid)
        {
            if (request == null || request.version != 1 || String.IsNullOrWhiteSpace(request.action))
            {
                return BrokerResponse.Failure("Unsupported remote broker request.");
            }

            if (String.Equals(request.action, "ping", StringComparison.Ordinal))
            {
                return BrokerResponse.Success();
            }
            if (String.Equals(request.action, "start_capture", StringComparison.Ordinal))
            {
                return StartCapture(request, clientPid);
            }
            if (String.Equals(request.action, "stop_capture", StringComparison.Ordinal))
            {
                if (request.ownerPid != clientPid)
                {
                    return BrokerResponse.Failure("The capture owner does not match the requesting process.");
                }
                StopCaptureForOwner(clientPid);
                return BrokerResponse.Success();
            }
            if (String.Equals(request.action, "restart_hid", StringComparison.Ordinal))
            {
                return RestartHid(request.instanceId);
            }
            return BrokerResponse.Failure("The requested remote broker action is not allowed.");
        }

        private BrokerResponse StartCapture(BrokerRequest request, int clientPid)
        {
            string validationError = ValidateCaptureRequest(request, clientPid);
            if (validationError != null)
            {
                return BrokerResponse.Failure(validationError);
            }
            if (!File.Exists(helperPath))
            {
                return BrokerResponse.Failure("The installed remote capture helper is missing. Repair the application installation.");
            }
            if (!File.Exists(usbPcapPath))
            {
                return BrokerResponse.Failure("USBPcap is not installed. Run the VibeCoding Voice installer and enable the Xiaomi remote driver.");
            }
            if (!VerifyBluetoothCaptureTarget(request))
            {
                return BrokerResponse.Failure("The requested USBPcap target is not the configured Bluetooth adapter.");
            }

            StopAllCaptures();

            string command = BuildCaptureCommand(request, clientPid);
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = "powershell.exe";
            startInfo.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " +
                Convert.ToBase64String(Encoding.Unicode.GetBytes(command));
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;

            Process process = new Process();
            process.StartInfo = startInfo;
            process.EnableRaisingEvents = true;
            if (!process.Start())
            {
                return BrokerResponse.Failure("The remote capture helper did not start.");
            }
            int helperPid = process.Id;
            try
            {
                AssignProcessToCaptureJob(process);
            }
            catch
            {
                try { process.Kill(); } catch { }
                process.Dispose();
                throw;
            }

            CaptureProcess capture = new CaptureProcess { OwnerPid = clientPid, Process = process };
            lock (captureLock)
            {
                captures.Add(capture);
            }
            process.Exited += delegate
            {
                lock (captureLock)
                {
                    captures.Remove(capture);
                }
                process.Dispose();
            };

            Log("capture helper started for client " + clientPid + " as pid " + helperPid);
            return new BrokerResponse { ok = true, pid = helperPid };
        }

        private string ValidateCaptureRequest(BrokerRequest request, int clientPid)
        {
            if (request.ownerPid != clientPid)
            {
                return "The capture owner does not match the requesting process.";
            }
            if (!PipeNamePattern.IsMatch(request.pipeName ?? String.Empty) ||
                !request.pipeName.StartsWith("vibecoding-xiaomi-" + clientPid + "-", StringComparison.OrdinalIgnoreCase))
            {
                return "The capture data pipe name is invalid.";
            }
            if (!InterfacePattern.IsMatch(request.interfaceName ?? String.Empty))
            {
                return "The USBPcap interface is invalid.";
            }
            if (!DeviceAddressPattern.IsMatch(request.deviceAddress ?? String.Empty))
            {
                return "The USB device address is invalid.";
            }
            int address;
            if (!Int32.TryParse(request.deviceAddress, out address) || address < 1 || address > 127)
            {
                return "The USB device address is outside the allowed range.";
            }
            if (!HidMatchPattern.IsMatch(request.hidDeviceMatch ?? String.Empty))
            {
                return "The remote HID identifier is invalid.";
            }
            if (!IsSafeFriendlyName(request.adapterMatch, 128))
            {
                return "The Bluetooth adapter name is invalid.";
            }
            if (request.adapterMatch.IndexOf("Bluetooth", StringComparison.OrdinalIgnoreCase) < 0)
            {
                return "The capture broker only accepts Bluetooth adapter targets.";
            }
            return null;
        }

        private bool VerifyBluetoothCaptureTarget(BrokerRequest request)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = usbPcapPath;
            startInfo.Arguments = "--extcap-interface \"" + request.interfaceName + "\" --extcap-config";
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;

            using (Process process = Process.Start(startInfo))
            {
                Task<string> stdoutTask = process.StandardOutput.ReadToEndAsync();
                Task<string> stderrTask = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(10000))
                {
                    process.Kill();
                    return false;
                }
                string stdout = stdoutTask.Result;
                stderrTask.Wait(1000);

                string addressPattern = @"\{value=" + Regex.Escape(request.deviceAddress) + @"(?:_[0-9]+)?\}";
                foreach (string line in stdout.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
                {
                    if (line.IndexOf(request.adapterMatch, StringComparison.OrdinalIgnoreCase) >= 0 &&
                        Regex.IsMatch(line, addressPattern, RegexOptions.CultureInvariant | RegexOptions.IgnoreCase))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private string BuildCaptureCommand(BrokerRequest request, int clientPid)
        {
            StringBuilder command = new StringBuilder();
            command.Append("$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; & ");
            command.Append(QuotePowerShell(helperPath));
            command.Append(" -PipeName ").Append(QuotePowerShell(request.pipeName));
            command.Append(" -UsbPcapPath ").Append(QuotePowerShell(usbPcapPath));
            command.Append(" -InterfaceName ").Append(QuotePowerShell(request.interfaceName));
            command.Append(" -DeviceAddress ").Append(QuotePowerShell(request.deviceAddress));
            command.Append(" -OwnerPid ").Append(clientPid);
            command.Append(" -LogDirectory ").Append(QuotePowerShell(logDirectory));
            if (!String.IsNullOrEmpty(request.hidDeviceMatch))
            {
                command.Append(" -HidDeviceMatch ").Append(QuotePowerShell(request.hidDeviceMatch));
            }
            if (!String.IsNullOrEmpty(request.adapterMatch))
            {
                command.Append(" -AdapterMatch ").Append(QuotePowerShell(request.adapterMatch));
            }
            if (request.allowInterfaceSwitch)
            {
                command.Append(" -AllowInterfaceSwitch");
            }
            return command.ToString();
        }

        private BrokerResponse RestartHid(string instanceId)
        {
            if (!IsAllowedHidInstance(instanceId))
            {
                return BrokerResponse.Failure("Only the supported Xiaomi HID child can be restarted.");
            }

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "pnputil.exe");
            startInfo.Arguments = "/restart-device \"" + instanceId + "\"";
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;

            using (Process process = Process.Start(startInfo))
            {
                Task<string> stdoutTask = process.StandardOutput.ReadToEndAsync();
                Task<string> stderrTask = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(45000))
                {
                    process.Kill();
                    return BrokerResponse.Failure("Timed out while restarting the remote HID device.");
                }
                string stdout = stdoutTask.Result;
                string stderr = stderrTask.Result;
                string output = (stdout + Environment.NewLine + stderr).Trim();
                Log("HID restart finished with code " + process.ExitCode);
                return new BrokerResponse
                {
                    ok = true,
                    exitCode = process.ExitCode,
                    output = output
                };
            }
        }

        private bool IsAllowedClient(int clientPid)
        {
            try
            {
                using (Process process = Process.GetProcessById(clientPid))
                {
                    uint activeConsoleSession = WTSGetActiveConsoleSessionId();
                    if (activeConsoleSession == UInt32.MaxValue || process.SessionId != (int)activeConsoleSession)
                    {
                        return false;
                    }
                    string clientPath = process.MainModule.FileName;
                    return String.Equals(
                        Path.GetFullPath(clientPath),
                        Path.GetFullPath(allowedClientPath),
                        StringComparison.OrdinalIgnoreCase
                    );
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool IsAllowedHidInstance(string instanceId)
        {
            if (String.IsNullOrEmpty(instanceId) || instanceId.Length > 512)
            {
                return false;
            }
            if (!instanceId.StartsWith("BTHLEDEVICE\\", StringComparison.OrdinalIgnoreCase) ||
                instanceId.IndexOf("{00001812-", StringComparison.OrdinalIgnoreCase) < 0 ||
                instanceId.IndexOf("VID&012717_PID&32B8", StringComparison.OrdinalIgnoreCase) < 0)
            {
                return false;
            }
            foreach (char character in instanceId)
            {
                if (!(Char.IsLetterOrDigit(character) || "\\_&{}-".IndexOf(character) >= 0))
                {
                    return false;
                }
            }
            return true;
        }

        private static bool IsSafeFriendlyName(string value, int maxLength)
        {
            if (String.IsNullOrEmpty(value) || value.Length > maxLength)
            {
                return false;
            }
            foreach (char character in value)
            {
                if (!(Char.IsLetterOrDigit(character) || " ._()&+-".IndexOf(character) >= 0))
                {
                    return false;
                }
            }
            return true;
        }

        private static string QuotePowerShell(string value)
        {
            return "'" + (value ?? String.Empty).Replace("'", "''") + "'";
        }

        private static string ReadLimitedLine(Stream stream)
        {
            List<byte> bytes = new List<byte>();
            while (bytes.Count <= MaxRequestCharacters * 4)
            {
                int next = stream.ReadByte();
                if (next < 0 || next == 10)
                {
                    break;
                }
                if (next != 13)
                {
                    bytes.Add((byte)next);
                }
            }
            if (bytes.Count == 0)
            {
                throw new InvalidDataException("The remote broker request was empty.");
            }
            if (bytes.Count > MaxRequestCharacters * 4)
            {
                throw new InvalidDataException("The remote broker request was too large.");
            }
            return Encoding.UTF8.GetString(bytes.ToArray());
        }

        private void WriteResponse(Stream stream, BrokerResponse response)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(serializer.Serialize(response) + "\n");
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
        }

        private void StopCaptureForOwner(int ownerPid)
        {
            List<CaptureProcess> matches;
            lock (captureLock)
            {
                matches = captures.FindAll(delegate(CaptureProcess capture) { return capture.OwnerPid == ownerPid; });
                captures.RemoveAll(delegate(CaptureProcess capture) { return capture.OwnerPid == ownerPid; });
            }
            foreach (CaptureProcess capture in matches)
            {
                KillCapture(capture);
            }
        }

        private void StopAllCaptures()
        {
            List<CaptureProcess> snapshot;
            lock (captureLock)
            {
                snapshot = new List<CaptureProcess>(captures);
                captures.Clear();
            }
            foreach (CaptureProcess capture in snapshot)
            {
                KillCapture(capture);
            }
        }

        private static void KillCapture(CaptureProcess capture)
        {
            try
            {
                if (!capture.Process.HasExited)
                {
                    ProcessStartInfo taskKill = new ProcessStartInfo();
                    taskKill.FileName = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.System),
                        "taskkill.exe"
                    );
                    taskKill.Arguments = "/PID " + capture.Process.Id + " /T /F";
                    taskKill.UseShellExecute = false;
                    taskKill.CreateNoWindow = true;
                    using (Process killer = Process.Start(taskKill))
                    {
                        killer.WaitForExit(5000);
                    }
                    if (!capture.Process.WaitForExit(3000))
                    {
                        capture.Process.Kill();
                    }
                }
            }
            catch
            {
                // The process already exited. The job object owns descendants.
            }
        }

        private void AssignProcessToCaptureJob(Process process)
        {
            if (captureJob == IntPtr.Zero || !AssignProcessToJobObject(captureJob, process.Handle))
            {
                throw new InvalidOperationException("Could not attach the capture helper to the service job object.");
            }
        }

        private static IntPtr CreateKillOnCloseJob()
        {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero)
            {
                throw new InvalidOperationException("Could not create the capture process job object.");
            }
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
            int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr pointer = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(info, pointer, false);
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, (uint)length))
                {
                    CloseHandle(job);
                    throw new InvalidOperationException("Could not configure the capture process job object.");
                }
            }
            finally
            {
                Marshal.FreeHGlobal(pointer);
            }
            return job;
        }

        private void WakeListener()
        {
            try
            {
                using (NamedPipeClientStream client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out))
                {
                    client.Connect(250);
                    client.WriteByte(10);
                }
            }
            catch
            {
                // The listener already stopped.
            }
        }

        private void Log(string message)
        {
            try
            {
                Directory.CreateDirectory(logDirectory);
                File.AppendAllText(
                    serviceLogPath,
                    DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss") + " " + message + Environment.NewLine,
                    Encoding.UTF8
                );
            }
            catch
            {
                // Logging must never stop the broker.
            }
        }

        private void HardenOwnServiceImagePath()
        {
            try
            {
                string executablePath = Process.GetCurrentProcess().MainModule.FileName;
                string quotedPath = "\"" + executablePath + "\"";
                using (RegistryKey serviceKey = Registry.LocalMachine.OpenSubKey(
                    "SYSTEM\\CurrentControlSet\\Services\\" + ServiceName,
                    true
                ))
                {
                    if (serviceKey == null)
                    {
                        throw new InvalidOperationException("The service registry key is missing.");
                    }
                    string current = Convert.ToString(serviceKey.GetValue("ImagePath"));
                    if (!String.Equals(current, quotedPath, StringComparison.Ordinal))
                    {
                        serviceKey.SetValue("ImagePath", quotedPath, RegistryValueKind.ExpandString);
                    }
                }
            }
            catch (Exception error)
            {
                Log("could not harden service ImagePath: " + error.Message);
                throw;
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientProcessId);

        [DllImport("kernel32.dll")]
        private static extern uint WTSGetActiveConsoleSessionId();

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);
    }
}
