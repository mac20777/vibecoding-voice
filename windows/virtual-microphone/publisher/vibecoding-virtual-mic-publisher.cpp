#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <propkey.h>
#include <functiondiscoverykeys_devpkey.h>
#include <propvarutil.h>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <deque>
#include <iterator>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

struct DeviceShareMode {
  DWORD mode;
};

struct __declspec(uuid("f8679f50-850a-41cf-9c72-430f290290c8")) IPolicyConfig
    : public IUnknown {
  virtual HRESULT STDMETHODCALLTYPE GetMixFormat(PCWSTR, WAVEFORMATEX**) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetDeviceFormat(PCWSTR, INT, WAVEFORMATEX**) = 0;
  virtual HRESULT STDMETHODCALLTYPE ResetDeviceFormat(PCWSTR) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetDeviceFormat(PCWSTR, WAVEFORMATEX*, WAVEFORMATEX*) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetProcessingPeriod(PCWSTR, INT, PINT64, PINT64) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetProcessingPeriod(PCWSTR, PINT64) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetShareMode(PCWSTR, DeviceShareMode*) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetShareMode(PCWSTR, DeviceShareMode*) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetPropertyValue(PCWSTR, INT, const PROPERTYKEY&,
                                                     PROPVARIANT*) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetPropertyValue(PCWSTR, INT, const PROPERTYKEY&,
                                                     const PROPVARIANT*) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetDefaultEndpoint(PCWSTR, ERole) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetEndpointVisibility(PCWSTR, INT) = 0;
};

class __declspec(uuid("870af99c-171d-4f9e-af0d-e63df40c2bc9")) PolicyConfigClient;

constexpr std::uint32_t kMagic = 0x524d4356;  // "VCMR" as little-endian bytes.
constexpr std::uint16_t kStart = 1;
constexpr std::uint16_t kPcm16 = 2;
constexpr std::uint16_t kStop = 3;
constexpr std::uint16_t kCancel = 4;
constexpr std::uint16_t kExit = 5;
constexpr std::uint16_t kPrepare = 6;
constexpr std::size_t kMaxPayload = 16 * 1024 * 1024;
constexpr std::size_t kMaxQueuedSamples = 16'000 * 5;
constexpr ULONGLONG kShortcutWatchdogMs = 2'000;
constexpr ULONGLONG kPreparedRouteWatchdogMs = 60'000;
constexpr DWORD kRouteSettleMs = 250;
constexpr DWORD kWechatVoiceStartupMs = 350;
constexpr DWORD kRouteRestoreDelayMs = 500;

constexpr ERole kCaptureRoles[] = {eConsole, eMultimedia, eCommunications};
constexpr const char* kCaptureRoleNames[] = {"console", "multimedia", "communications"};

#pragma pack(push, 1)
struct MessageHeader {
  std::uint32_t magic;
  std::uint16_t type;
  std::uint16_t flags;
  std::uint32_t payloadBytes;
};
#pragma pack(pop)

static_assert(sizeof(MessageHeader) == 12, "Protocol header size changed");

template <typename T>
void ReleaseCom(T*& value) {
  if (value) {
    value->Release();
    value = nullptr;
  }
}

std::string WideToUtf8(const std::wstring& value) {
  if (value.empty()) {
    return {};
  }
  const int bytes = WideCharToMultiByte(
      CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(static_cast<std::size_t>(bytes), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                      result.data(), bytes, nullptr, nullptr);
  return result;
}

std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) {
    return {};
  }
  const int chars = MultiByteToWideChar(
      CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
  if (chars <= 0) {
    return {};
  }
  std::wstring result(static_cast<std::size_t>(chars), L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                      static_cast<int>(value.size()), result.data(), chars);
  return result;
}

std::string JsonEscape(const std::string& value) {
  std::string result;
  result.reserve(value.size() + 16);
  for (const unsigned char ch : value) {
    switch (ch) {
      case '\\': result += "\\\\"; break;
      case '"': result += "\\\""; break;
      case '\b': result += "\\b"; break;
      case '\f': result += "\\f"; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      default:
        if (ch < 0x20) {
          char escaped[7]{};
          std::snprintf(escaped, sizeof(escaped), "\\u%04x", ch);
          result += escaped;
        } else {
          result.push_back(static_cast<char>(ch));
        }
    }
  }
  return result;
}

void WriteJsonLine(const std::string& value) {
  std::fwrite(value.data(), 1, value.size(), stdout);
  std::fwrite("\n", 1, 1, stdout);
  std::fflush(stdout);
}

void WriteError(const std::string& value) {
  const std::string line = value + "\n";
  std::fwrite(line.data(), 1, line.size(), stderr);
  std::fflush(stderr);
}

std::string HresultText(HRESULT result) {
  char buffer[32]{};
  std::snprintf(buffer, sizeof(buffer), "0x%08lx", static_cast<unsigned long>(result));
  return buffer;
}

bool ReadExact(HANDLE input, void* target, std::size_t bytes) {
  auto* cursor = static_cast<std::uint8_t*>(target);
  std::size_t remaining = bytes;
  while (remaining > 0) {
    DWORD read = 0;
    const DWORD request = static_cast<DWORD>(std::min<std::size_t>(remaining, MAXDWORD));
    if (!ReadFile(input, cursor, request, &read, nullptr) || read == 0) {
      return false;
    }
    cursor += read;
    remaining -= read;
  }
  return true;
}

std::wstring GetFriendlyName(IMMDevice* device) {
  IPropertyStore* properties = nullptr;
  PROPVARIANT value;
  PropVariantInit(&value);
  std::wstring result;
  if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &properties)) &&
      SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &value)) &&
      value.vt == VT_LPWSTR && value.pwszVal) {
    result = value.pwszVal;
  }
  PropVariantClear(&value);
  ReleaseCom(properties);
  return result;
}

std::wstring GetDeviceId(IMMDevice* device) {
  LPWSTR value = nullptr;
  std::wstring result;
  if (device && SUCCEEDED(device->GetId(&value)) && value) {
    result = value;
  }
  CoTaskMemFree(value);
  return result;
}

HRESULT FindEndpoint(EDataFlow flow, const std::wstring& requestedName, IMMDevice** found) {
  *found = nullptr;
  IMMDeviceEnumerator* enumerator = nullptr;
  IMMDeviceCollection* collection = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void**>(&enumerator));
  if (FAILED(hr)) {
    return hr;
  }
  hr = enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &collection);
  if (FAILED(hr)) {
    ReleaseCom(enumerator);
    return hr;
  }
  UINT count = 0;
  collection->GetCount(&count);
  for (UINT index = 0; index < count; ++index) {
    IMMDevice* device = nullptr;
    if (FAILED(collection->Item(index, &device))) {
      continue;
    }
    const std::wstring friendlyName = GetFriendlyName(device);
    if (_wcsicmp(friendlyName.c_str(), requestedName.c_str()) == 0) {
      *found = device;
      break;
    }
    ReleaseCom(device);
  }
  ReleaseCom(collection);
  ReleaseCom(enumerator);
  return *found ? S_OK : HRESULT_FROM_WIN32(ERROR_NOT_FOUND);
}

HRESULT FindRenderEndpoint(const std::wstring& requestedName, IMMDevice** found) {
  return FindEndpoint(eRender, requestedName, found);
}

HRESULT FindCaptureEndpoint(const std::wstring& requestedName, IMMDevice** found) {
  return FindEndpoint(eCapture, requestedName, found);
}

HRESULT CreatePolicyConfig(IPolicyConfig** policy) {
  *policy = nullptr;
  return CoCreateInstance(__uuidof(PolicyConfigClient), nullptr, CLSCTX_ALL,
                          __uuidof(IPolicyConfig), reinterpret_cast<void**>(policy));
}

std::wstring GetDefaultCaptureEndpointId(IMMDeviceEnumerator* enumerator, ERole role) {
  IMMDevice* device = nullptr;
  std::wstring id;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eCapture, role, &device))) {
    id = GetDeviceId(device);
  }
  ReleaseCom(device);
  return id;
}

struct RouteState {
  DWORD ownerPid = 0;
  std::wstring targetEndpointId;
  std::map<int, std::wstring> defaultEndpointIds;
};

bool WriteTextFileAtomically(const std::wstring& path, const std::string& contents) {
  const std::wstring temporaryPath = path + L".tmp-" + std::to_wstring(GetCurrentProcessId());
  HANDLE file = CreateFileW(temporaryPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return false;
  }
  DWORD written = 0;
  const bool writeOk = contents.size() <= MAXDWORD &&
      WriteFile(file, contents.data(), static_cast<DWORD>(contents.size()), &written, nullptr) &&
      written == contents.size() && FlushFileBuffers(file);
  CloseHandle(file);
  if (!writeOk) {
    DeleteFileW(temporaryPath.c_str());
    return false;
  }
  if (!MoveFileExW(temporaryPath.c_str(), path.c_str(),
                   MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    DeleteFileW(temporaryPath.c_str());
    return false;
  }
  return true;
}

bool ReadTextFile(const std::wstring& path, std::string* contents) {
  contents->clear();
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE |
                            FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return false;
  }
  LARGE_INTEGER size{};
  if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || size.QuadPart > 64 * 1024) {
    CloseHandle(file);
    return false;
  }
  contents->resize(static_cast<std::size_t>(size.QuadPart));
  DWORD read = 0;
  const bool readOk = contents->empty() ||
      (ReadFile(file, contents->data(), static_cast<DWORD>(contents->size()), &read, nullptr) &&
       read == contents->size());
  CloseHandle(file);
  if (!readOk) {
    contents->clear();
  }
  return readOk;
}

std::string SerializeRouteState(const RouteState& state) {
  std::string contents = "version=1\nowner_pid=" + std::to_string(state.ownerPid) +
                         "\ntarget=" + WideToUtf8(state.targetEndpointId) + "\n";
  for (std::size_t index = 0; index < std::size(kCaptureRoles); ++index) {
    const auto found = state.defaultEndpointIds.find(static_cast<int>(kCaptureRoles[index]));
    contents += std::string(kCaptureRoleNames[index]) + "=" +
                (found == state.defaultEndpointIds.end() ? "" : WideToUtf8(found->second)) + "\n";
  }
  return contents;
}

bool ParseRouteState(const std::string& contents, RouteState* state) {
  *state = RouteState{};
  std::map<std::string, std::string> fields;
  std::size_t offset = 0;
  while (offset <= contents.size()) {
    const std::size_t next = contents.find('\n', offset);
    std::string line = contents.substr(offset, next == std::string::npos
        ? std::string::npos : next - offset);
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }
    const std::size_t separator = line.find('=');
    if (separator != std::string::npos) {
      fields[line.substr(0, separator)] = line.substr(separator + 1);
    }
    if (next == std::string::npos) {
      break;
    }
    offset = next + 1;
  }
  if (fields["version"] != "1" || fields["target"].empty()) {
    return false;
  }
  try {
    state->ownerPid = static_cast<DWORD>(std::stoul(fields["owner_pid"]));
  } catch (...) {
    return false;
  }
  state->targetEndpointId = Utf8ToWide(fields["target"]);
  for (std::size_t index = 0; index < std::size(kCaptureRoles); ++index) {
    state->defaultEndpointIds[static_cast<int>(kCaptureRoles[index])] =
        Utf8ToWide(fields[kCaptureRoleNames[index]]);
  }
  return !state->targetEndpointId.empty();
}

bool IsProcessAlive(DWORD processId) {
  if (processId == 0) {
    return false;
  }
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (!process) {
    return false;
  }
  DWORD exitCode = 0;
  const bool alive = GetExitCodeProcess(process, &exitCode) && exitCode == STILL_ACTIVE;
  CloseHandle(process);
  return alive;
}

bool RestoreRouteState(const std::wstring& path, bool force, bool report) {
  if (path.empty()) {
    return true;
  }
  std::string contents;
  if (!ReadTextFile(path, &contents)) {
    return true;
  }
  RouteState state;
  if (!ParseRouteState(contents, &state)) {
    DeleteFileW(path.c_str());
    if (report) {
      WriteJsonLine("{\"type\":\"route_restore_discarded\",\"reason\":\"invalid_state\"}");
    }
    return false;
  }
  if (!force && state.ownerPid != GetCurrentProcessId() && IsProcessAlive(state.ownerPid)) {
    if (report) {
      WriteJsonLine("{\"type\":\"route_restore_skipped\",\"reason\":\"owner_active\"}");
    }
    return false;
  }

  IMMDeviceEnumerator* enumerator = nullptr;
  IPolicyConfig* policy = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void**>(&enumerator));
  if (SUCCEEDED(hr)) {
    hr = CreatePolicyConfig(&policy);
  }
  bool restoredAny = false;
  bool success = SUCCEEDED(hr);
  if (success) {
    for (const ERole role : kCaptureRoles) {
      const auto found = state.defaultEndpointIds.find(static_cast<int>(role));
      if (found == state.defaultEndpointIds.end() || found->second.empty()) {
        continue;
      }
      const std::wstring current = GetDefaultCaptureEndpointId(enumerator, role);
      if (_wcsicmp(current.c_str(), state.targetEndpointId.c_str()) != 0) {
        continue;
      }
      const HRESULT roleResult = policy->SetDefaultEndpoint(found->second.c_str(), role);
      success = success && SUCCEEDED(roleResult);
      restoredAny = restoredAny || SUCCEEDED(roleResult);
    }
  }
  ReleaseCom(policy);
  ReleaseCom(enumerator);
  if (success) {
    DeleteFileW(path.c_str());
  }
  if (report) {
    WriteJsonLine("{\"type\":\"route_restore\",\"restored\":" +
                  std::string(restoredAny ? "true" : "false") +
                  ",\"success\":" + std::string(success ? "true" : "false") + "}");
  }
  return success;
}

class DefaultCaptureRouter {
 public:
  DefaultCaptureRouter(std::wstring captureEndpointName, std::wstring statePath, bool enabled)
      : captureEndpointName_(std::move(captureEndpointName)),
        statePath_(std::move(statePath)), enabled_(enabled) {}

  bool Begin() {
    if (!enabled_ || active_) {
      return true;
    }
    if (!RestoreRouteState(statePath_, false, false)) {
      WriteJsonLine("{\"type\":\"route_error\",\"error\":\"stale route recovery failed\"}");
      return false;
    }

    IMMDevice* target = nullptr;
    IMMDeviceEnumerator* enumerator = nullptr;
    IPolicyConfig* policy = nullptr;
    HRESULT hr = FindCaptureEndpoint(captureEndpointName_, &target);
    RouteState state;
    state.ownerPid = GetCurrentProcessId();
    if (SUCCEEDED(hr)) {
      state.targetEndpointId = GetDeviceId(target);
      hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                            __uuidof(IMMDeviceEnumerator),
                            reinterpret_cast<void**>(&enumerator));
    }
    if (SUCCEEDED(hr)) {
      for (const ERole role : kCaptureRoles) {
        state.defaultEndpointIds[static_cast<int>(role)] =
            GetDefaultCaptureEndpointId(enumerator, role);
      }
      if (!WriteTextFileAtomically(statePath_, SerializeRouteState(state))) {
        hr = HRESULT_FROM_WIN32(GetLastError() == ERROR_SUCCESS ? ERROR_WRITE_FAULT : GetLastError());
      }
    }
    if (SUCCEEDED(hr)) {
      hr = CreatePolicyConfig(&policy);
    }
    if (SUCCEEDED(hr)) {
      for (const ERole role : kCaptureRoles) {
        const HRESULT roleResult = policy->SetDefaultEndpoint(state.targetEndpointId.c_str(), role);
        if (FAILED(roleResult)) {
          hr = roleResult;
          break;
        }
      }
    }
    ReleaseCom(policy);
    ReleaseCom(enumerator);
    ReleaseCom(target);
    if (FAILED(hr)) {
      RestoreRouteState(statePath_, true, false);
      WriteJsonLine("{\"type\":\"route_error\",\"error\":\"" +
                    JsonEscape(HresultText(hr)) + "\"}");
      return false;
    }
    active_ = true;
    WriteJsonLine("{\"type\":\"route_switched\",\"captureEndpoint\":\"" +
                  JsonEscape(WideToUtf8(captureEndpointName_)) + "\"}");
    return true;
  }

  void Restore() {
    if (!enabled_ || (!active_ && GetFileAttributesW(statePath_.c_str()) == INVALID_FILE_ATTRIBUTES)) {
      return;
    }
    const bool restored = RestoreRouteState(statePath_, true, false);
    active_ = false;
    WriteJsonLine("{\"type\":\"route_restored\",\"success\":" +
                  std::string(restored ? "true" : "false") + "}");
  }

 private:
  std::wstring captureEndpointName_;
  std::wstring statePath_;
  bool enabled_ = false;
  bool active_ = false;
};

int ListEndpoints(EDataFlow flow, const char* flowName) {
  IMMDeviceEnumerator* enumerator = nullptr;
  IMMDeviceCollection* collection = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void**>(&enumerator));
  if (FAILED(hr)) {
    WriteError("Could not create the Windows audio endpoint enumerator: " + HresultText(hr));
    return 2;
  }
  hr = enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &collection);
  if (FAILED(hr)) {
    WriteError("Could not enumerate audio endpoints: " + HresultText(hr));
    ReleaseCom(enumerator);
    return 2;
  }
  UINT count = 0;
  collection->GetCount(&count);
  for (UINT index = 0; index < count; ++index) {
    IMMDevice* device = nullptr;
    if (SUCCEEDED(collection->Item(index, &device))) {
      const std::string name = WideToUtf8(GetFriendlyName(device));
      WriteJsonLine("{\"type\":\"endpoint\",\"flow\":\"" + std::string(flowName) +
                    "\",\"name\":\"" + JsonEscape(name) + "\"}");
    }
    ReleaseCom(device);
  }
  ReleaseCom(collection);
  ReleaseCom(enumerator);
  return 0;
}

int ListAllEndpoints() {
  const int renderResult = ListEndpoints(eRender, "render");
  if (renderResult != 0) {
    return renderResult;
  }
  return ListEndpoints(eCapture, "capture");
}

int ListDefaultCaptureEndpoints() {
  IMMDeviceEnumerator* enumerator = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void**>(&enumerator));
  if (FAILED(hr)) {
    WriteError("Could not create the Windows audio endpoint enumerator: " + HresultText(hr));
    return 2;
  }
  for (std::size_t index = 0; index < std::size(kCaptureRoles); ++index) {
    IMMDevice* device = nullptr;
    hr = enumerator->GetDefaultAudioEndpoint(eCapture, kCaptureRoles[index], &device);
    if (SUCCEEDED(hr)) {
      WriteJsonLine("{\"type\":\"default_capture\",\"role\":\"" +
                    std::string(kCaptureRoleNames[index]) + "\",\"name\":\"" +
                    JsonEscape(WideToUtf8(GetFriendlyName(device))) + "\",\"id\":\"" +
                    JsonEscape(WideToUtf8(GetDeviceId(device))) + "\"}");
    }
    ReleaseCom(device);
  }
  ReleaseCom(enumerator);
  return 0;
}

class SampleQueue {
 public:
  void Start() {
    std::lock_guard<std::mutex> lock(mutex_);
    samples_.clear();
    accepting_ = true;
    draining_ = false;
    drainCompleted_ = false;
  }

  void Push(const std::uint8_t* bytes, std::size_t length) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!accepting_ || length % sizeof(std::int16_t) != 0) {
      return;
    }
    const auto* pcm = reinterpret_cast<const std::int16_t*>(bytes);
    const std::size_t sampleCount = length / sizeof(std::int16_t);
    for (std::size_t index = 0; index < sampleCount; ++index) {
      samples_.push_back(pcm[index]);
    }
    while (samples_.size() > kMaxQueuedSamples) {
      samples_.pop_front();
    }
  }

  void Stop() {
    std::lock_guard<std::mutex> lock(mutex_);
    accepting_ = false;
    if (samples_.empty()) {
      draining_ = false;
      drainCompleted_ = true;
    } else {
      draining_ = true;
    }
  }

  void Cancel() {
    std::lock_guard<std::mutex> lock(mutex_);
    samples_.clear();
    accepting_ = false;
    draining_ = false;
    drainCompleted_ = false;
  }

  std::size_t Read(std::int16_t* output, std::size_t capacity) {
    std::lock_guard<std::mutex> lock(mutex_);
    const std::size_t count = std::min(capacity, samples_.size());
    for (std::size_t index = 0; index < count; ++index) {
      output[index] = samples_.front();
      samples_.pop_front();
    }
    if (samples_.empty() && draining_) {
      draining_ = false;
      drainCompleted_ = true;
    }
    return count;
  }

  bool ConsumeDrainCompleted() {
    std::lock_guard<std::mutex> lock(mutex_);
    const bool completed = drainCompleted_;
    drainCompleted_ = false;
    return completed;
  }

 private:
  std::mutex mutex_;
  std::deque<std::int16_t> samples_;
  bool accepting_ = false;
  bool draining_ = false;
  bool drainCompleted_ = false;
};

bool SendKeyboardScanCode(WORD scanCode, bool extended, bool keyUp) {
  INPUT input{};
  input.type = INPUT_KEYBOARD;
  input.ki.wScan = scanCode;
  input.ki.dwFlags = KEYEVENTF_SCANCODE |
                     (extended ? KEYEVENTF_EXTENDEDKEY : 0) |
                     (keyUp ? KEYEVENTF_KEYUP : 0);
  return SendInput(1, &input, sizeof(INPUT)) == 1;
}

bool SendWechatVoiceToggleChord() {
  // WeChat Input Method exposes Ctrl+Win+Shift as its tap-to-start/tap-to-stop
  // voice shortcut. Send each modifier as a physical Set-1 scan code so its
  // low-level hook sees the same sequence as a real keyboard.
  const bool controlPressed = SendKeyboardScanCode(0x1d, false, false);
  if (!controlPressed) {
    return false;
  }
  Sleep(25);
  const bool windowsPressed = SendKeyboardScanCode(0x5b, true, false);
  if (!windowsPressed) {
    SendKeyboardScanCode(0x1d, false, true);
    return false;
  }
  Sleep(25);
  const bool shiftPressed = SendKeyboardScanCode(0x2a, false, false);
  if (!shiftPressed) {
    SendKeyboardScanCode(0x5b, true, true);
    SendKeyboardScanCode(0x1d, false, true);
    return false;
  }
  Sleep(60);
  const bool shiftReleased = SendKeyboardScanCode(0x2a, false, true);
  Sleep(15);
  const bool windowsReleased = SendKeyboardScanCode(0x5b, true, true);
  Sleep(15);
  const bool controlReleased = SendKeyboardScanCode(0x1d, false, true);
  return shiftReleased && windowsReleased && controlReleased;
}

class WechatShortcut {
 public:
  WechatShortcut(bool enabled, std::wstring captureEndpointName, std::wstring routeStatePath)
      : enabled_(enabled), router_(std::move(captureEndpointName),
                                  std::move(routeStatePath), enabled) {}

  void Touch() {
    lastActivity_.store(GetTickCount64());
  }

  bool Prepare() {
    if (!enabled_) {
      return true;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    lastActivity_.store(GetTickCount64());
    if (active_) {
      return false;
    }
    if (!routeActive_) {
      if (!router_.Begin()) {
        return false;
      }
      routeActive_ = true;
      routePreparedAt_ = GetTickCount64();
    }
    WriteJsonLine("{\"type\":\"route_prepared\"}");
    return true;
  }

  bool Press() {
    if (!enabled_) {
      return true;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    lastActivity_.store(GetTickCount64());
    if (active_) {
      WriteJsonLine("{\"type\":\"shortcut_error\",\"error\":\"shortcut already active\"}");
      return false;
    }
    if (!routeActive_) {
      if (!router_.Begin()) {
        return false;
      }
      routeActive_ = true;
      routePreparedAt_ = GetTickCount64();
    }
    const ULONGLONG now = GetTickCount64();
    const ULONGLONG preparedFor = routePreparedAt_ == 0 ? 0 : now - routePreparedAt_;
    if (preparedFor < kRouteSettleMs) {
      Sleep(static_cast<DWORD>(kRouteSettleMs - preparedFor));
    }
    if (SendWechatVoiceToggleChord()) {
      active_ = true;
      routePreparedAt_ = 0;
      // Acknowledge only after WeChat has had time to create its recognition
      // session and open the already-prepared virtual capture endpoint.
      Sleep(kWechatVoiceStartupMs);
      WriteJsonLine("{\"type\":\"shortcut_pressed\",\"shortcut\":\"Ctrl+Win+Shift\","
                    "\"method\":\"scan_code_toggle\"}");
      return true;
    }
    router_.Restore();
    routeActive_ = false;
    routePreparedAt_ = 0;
    WriteJsonLine("{\"type\":\"shortcut_error\",\"error\":\"scan-code SendInput failed\"}");
    return false;
  }

  void Release(const char* reason) {
    if (!enabled_) {
      return;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    if (!active_ && !routeActive_) {
      return;
    }
    const bool shortcutWasActive = active_;
    if (shortcutWasActive) {
      const bool stopped = SendWechatVoiceToggleChord();
      active_ = false;
      if (stopped) {
        WriteJsonLine("{\"type\":\"shortcut_released\",\"shortcut\":\"Ctrl+Win+Shift\","
                      "\"method\":\"scan_code_toggle\"}");
      } else {
        WriteJsonLine("{\"type\":\"shortcut_error\","
                      "\"error\":\"scan-code stop toggle failed\"}");
      }
      Sleep(kRouteRestoreDelayMs);
    }
    if (routeActive_) {
      router_.Restore();
      routeActive_ = false;
    }
    routePreparedAt_ = 0;
    WriteJsonLine("{\"type\":\"session_idle\",\"reason\":\"" +
                  JsonEscape(reason ? reason : "unknown") + "\"}");
  }

  void ReleaseIfStale() {
    if (!enabled_) {
      return;
    }
    const ULONGLONG elapsed = GetTickCount64() - lastActivity_.load();
    bool shouldRelease = false;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      shouldRelease = (active_ && elapsed > kShortcutWatchdogMs) ||
                      (!active_ && routeActive_ && elapsed > kPreparedRouteWatchdogMs);
    }
    if (shouldRelease) {
      Release("watchdog");
    }
  }

 private:
  bool enabled_ = false;
  bool active_ = false;
  bool routeActive_ = false;
  ULONGLONG routePreparedAt_ = 0;
  std::atomic<ULONGLONG> lastActivity_{0};
  std::mutex mutex_;
  DefaultCaptureRouter router_;
};

void ProtocolReader(HANDLE input, SampleQueue& queue, WechatShortcut& shortcut,
                    std::atomic<bool>& exiting) {
  std::size_t sessionAudioBytes = 0;
  while (!exiting.load()) {
    MessageHeader header{};
    if (!ReadExact(input, &header, sizeof(header))) {
      exiting.store(true);
      break;
    }
    if (header.magic != kMagic || header.flags != 0 || header.payloadBytes > kMaxPayload) {
      WriteError("Invalid virtual microphone protocol header");
      exiting.store(true);
      break;
    }
    std::vector<std::uint8_t> payload(header.payloadBytes);
    if (!payload.empty() && !ReadExact(input, payload.data(), payload.size())) {
      exiting.store(true);
      break;
    }
    shortcut.Touch();
    switch (header.type) {
      case kPrepare:
        if (!shortcut.Prepare()) {
          exiting.store(true);
        }
        break;
      case kStart:
        sessionAudioBytes = 0;
        queue.Start();
        if (!shortcut.Press()) {
          queue.Cancel();
          exiting.store(true);
        }
        break;
      case kPcm16:
        if (payload.size() % sizeof(std::int16_t) != 0) {
          WriteError("PCM16 payload contains a partial sample");
          exiting.store(true);
          break;
        }
        if (sessionAudioBytes == 0 && !payload.empty()) {
          WriteJsonLine("{\"type\":\"audio_received\",\"bytes\":" +
                        std::to_string(payload.size()) + "}");
        }
        sessionAudioBytes += payload.size();
        queue.Push(payload.data(), payload.size());
        break;
      case kStop:
        WriteJsonLine("{\"type\":\"audio_completed\",\"bytes\":" +
                      std::to_string(sessionAudioBytes) + "}");
        queue.Stop();
        break;
      case kCancel:
        queue.Cancel();
        shortcut.Release("cancel");
        break;
      case kExit:
        shortcut.Release("exit");
        exiting.store(true);
        break;
      default:
        WriteError("Unknown virtual microphone protocol message");
        exiting.store(true);
        break;
    }
  }
  shortcut.Release("reader_closed");
}

int RunPublisher(const std::wstring& endpointName,
                 const std::wstring& captureEndpointName,
                 const std::wstring& routeStatePath,
                 bool wechatShortcutEnabled) {
  if (wechatShortcutEnabled) {
    RestoreRouteState(routeStatePath, false, true);
  }
  IMMDevice* endpoint = nullptr;
  HRESULT hr = FindRenderEndpoint(endpointName, &endpoint);
  if (FAILED(hr)) {
    WriteError("Render endpoint not found: " + WideToUtf8(endpointName));
    return 3;
  }

  IAudioClient* audioClient = nullptr;
  IAudioRenderClient* renderClient = nullptr;
  HANDLE audioEvent = nullptr;
  hr = endpoint->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                          reinterpret_cast<void**>(&audioClient));
  if (FAILED(hr)) {
    WriteError("Could not activate render endpoint: " + HresultText(hr));
    ReleaseCom(endpoint);
    return 4;
  }

  WAVEFORMATEX format{};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 1;
  format.nSamplesPerSec = 16'000;
  format.wBitsPerSample = 16;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  const DWORD flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                      AUDCLNT_STREAMFLAGS_NOPERSIST |
                      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                      AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, &format, nullptr);
  if (FAILED(hr)) {
    WriteError("Could not initialize 16 kHz mono render stream: " + HresultText(hr));
    ReleaseCom(audioClient);
    ReleaseCom(endpoint);
    return 5;
  }

  audioEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!audioEvent || FAILED(audioClient->SetEventHandle(audioEvent))) {
    WriteError("Could not create the WASAPI render event");
    if (audioEvent) CloseHandle(audioEvent);
    ReleaseCom(audioClient);
    ReleaseCom(endpoint);
    return 6;
  }
  hr = audioClient->GetService(__uuidof(IAudioRenderClient),
                               reinterpret_cast<void**>(&renderClient));
  if (FAILED(hr)) {
    WriteError("Could not open IAudioRenderClient: " + HresultText(hr));
    CloseHandle(audioEvent);
    ReleaseCom(audioClient);
    ReleaseCom(endpoint);
    return 7;
  }

  UINT32 bufferFrames = 0;
  audioClient->GetBufferSize(&bufferFrames);
  BYTE* initial = nullptr;
  if (SUCCEEDED(renderClient->GetBuffer(bufferFrames, &initial))) {
    renderClient->ReleaseBuffer(bufferFrames, AUDCLNT_BUFFERFLAGS_SILENT);
  }
  hr = audioClient->Start();
  if (FAILED(hr)) {
    WriteError("Could not start render stream: " + HresultText(hr));
    ReleaseCom(renderClient);
    CloseHandle(audioEvent);
    ReleaseCom(audioClient);
    ReleaseCom(endpoint);
    return 8;
  }

  SampleQueue queue;
  WechatShortcut shortcut(wechatShortcutEnabled, captureEndpointName, routeStatePath);
  std::atomic<bool> exiting{false};
  std::thread reader(ProtocolReader, GetStdHandle(STD_INPUT_HANDLE),
                     std::ref(queue), std::ref(shortcut), std::ref(exiting));
  WriteJsonLine("{\"type\":\"ready\",\"endpoint\":\"" +
                JsonEscape(WideToUtf8(endpointName)) +
                "\",\"sampleRate\":16000,\"channels\":1,\"bitsPerSample\":16}");

  while (!exiting.load()) {
    shortcut.ReleaseIfStale();
    const DWORD wait = WaitForSingleObject(audioEvent, 100);
    if (wait != WAIT_OBJECT_0) {
      continue;
    }
    UINT32 padding = 0;
    if (FAILED(audioClient->GetCurrentPadding(&padding)) || padding >= bufferFrames) {
      continue;
    }
    const UINT32 available = bufferFrames - padding;
    BYTE* target = nullptr;
    if (FAILED(renderClient->GetBuffer(available, &target))) {
      continue;
    }
    auto* output = reinterpret_cast<std::int16_t*>(target);
    const std::size_t copied = queue.Read(output, available);
    std::fill(output + copied, output + available, std::int16_t{0});
    renderClient->ReleaseBuffer(available, 0);
    if (queue.ConsumeDrainCompleted()) {
      shortcut.Release("drain");
    }
  }

  shortcut.Release("shutdown");
  CancelSynchronousIo(reader.native_handle());
  if (reader.joinable()) {
    reader.join();
  }
  audioClient->Stop();
  ReleaseCom(renderClient);
  CloseHandle(audioEvent);
  ReleaseCom(audioClient);
  ReleaseCom(endpoint);
  return 0;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  SetConsoleOutputCP(CP_UTF8);
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    WriteError("COM initialization failed: " + HresultText(hr));
    return 2;
  }

  int result = 0;
  if (argc == 2 && std::wstring(argv[1]) == L"--list") {
    result = ListAllEndpoints();
  } else if (argc == 2 && std::wstring(argv[1]) == L"--list-default-capture") {
    result = ListDefaultCaptureEndpoints();
  } else if (argc == 3 && std::wstring(argv[1]) == L"--restore-route") {
    result = RestoreRouteState(argv[2], false, true) ? 0 : 9;
  } else if (argc >= 3 && std::wstring(argv[1]) == L"--endpoint") {
    const std::wstring endpointName = argv[2];
    std::wstring captureEndpointName;
    std::wstring routeStatePath;
    bool wechatShortcut = false;
    bool valid = true;
    for (int index = 3; index < argc; ++index) {
      const std::wstring option = argv[index];
      if (option == L"--wechat-shortcut") {
        wechatShortcut = true;
      } else if (option == L"--capture-endpoint" && index + 1 < argc) {
        captureEndpointName = argv[++index];
      } else if (option == L"--route-state" && index + 1 < argc) {
        routeStatePath = argv[++index];
      } else {
        valid = false;
        break;
      }
    }
    if (wechatShortcut && (captureEndpointName.empty() || routeStatePath.empty())) {
      valid = false;
    }
    result = valid
        ? RunPublisher(endpointName, captureEndpointName, routeStatePath, wechatShortcut)
        : 1;
  } else {
    result = 1;
  }
  if (result == 1) {
    WriteError("Usage: vibecoding-virtual-mic-publisher.exe --list | --list-default-capture | "
               "--restore-route <state path> | --endpoint <render name> "
               "[--wechat-shortcut --capture-endpoint <capture name> "
               "--route-state <state path>]");
  }
  CoUninitialize();
  return result;
}
