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
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr std::uint32_t kMagic = 0x524d4356;  // "VCMR" as little-endian bytes.
constexpr std::uint16_t kStart = 1;
constexpr std::uint16_t kPcm16 = 2;
constexpr std::uint16_t kStop = 3;
constexpr std::uint16_t kCancel = 4;
constexpr std::uint16_t kExit = 5;
constexpr std::size_t kMaxPayload = 16 * 1024 * 1024;
constexpr std::size_t kMaxQueuedSamples = 16'000 * 5;
constexpr ULONGLONG kShortcutWatchdogMs = 2'000;

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

HRESULT FindRenderEndpoint(const std::wstring& requestedName, IMMDevice** found) {
  *found = nullptr;
  IMMDeviceEnumerator* enumerator = nullptr;
  IMMDeviceCollection* collection = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void**>(&enumerator));
  if (FAILED(hr)) {
    return hr;
  }
  hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection);
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

class WechatShortcut {
 public:
  explicit WechatShortcut(bool enabled) : enabled_(enabled) {}

  void Touch() {
    lastActivity_.store(GetTickCount64());
  }

  void Press() {
    if (!enabled_) {
      return;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    lastActivity_.store(GetTickCount64());
    if (held_) {
      return;
    }
    INPUT inputs[2]{};
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = VK_LCONTROL;
    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].ki.wVk = VK_LWIN;
    if (SendInput(2, inputs, sizeof(INPUT)) == 2) {
      held_ = true;
    }
  }

  void Release() {
    if (!enabled_) {
      return;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    if (!held_) {
      return;
    }
    INPUT inputs[2]{};
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = VK_LWIN;
    inputs[0].ki.dwFlags = KEYEVENTF_KEYUP;
    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].ki.wVk = VK_LCONTROL;
    inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(2, inputs, sizeof(INPUT));
    held_ = false;
  }

  void ReleaseIfStale() {
    if (enabled_ && GetTickCount64() - lastActivity_.load() > kShortcutWatchdogMs) {
      Release();
    }
  }

 private:
  bool enabled_ = false;
  bool held_ = false;
  std::atomic<ULONGLONG> lastActivity_{0};
  std::mutex mutex_;
};

void ProtocolReader(HANDLE input, SampleQueue& queue, WechatShortcut& shortcut,
                    std::atomic<bool>& exiting) {
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
      case kStart:
        queue.Start();
        shortcut.Press();
        break;
      case kPcm16:
        if (payload.size() % sizeof(std::int16_t) != 0) {
          WriteError("PCM16 payload contains a partial sample");
          exiting.store(true);
          break;
        }
        queue.Push(payload.data(), payload.size());
        break;
      case kStop:
        queue.Stop();
        break;
      case kCancel:
        queue.Cancel();
        shortcut.Release();
        break;
      case kExit:
        shortcut.Release();
        exiting.store(true);
        break;
      default:
        WriteError("Unknown virtual microphone protocol message");
        exiting.store(true);
        break;
    }
  }
  shortcut.Release();
}

int RunPublisher(const std::wstring& endpointName, bool wechatShortcutEnabled) {
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
  WechatShortcut shortcut(wechatShortcutEnabled);
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
      shortcut.Release();
    }
  }

  shortcut.Release();
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
  } else if ((argc == 3 || argc == 4) && std::wstring(argv[1]) == L"--endpoint" &&
             (argc == 3 || std::wstring(argv[3]) == L"--wechat-shortcut")) {
    const bool wechatShortcut = argc == 4;
    result = RunPublisher(argv[2], wechatShortcut);
  } else {
    WriteError("Usage: vibecoding-virtual-mic-publisher.exe --list | --endpoint <friendly name> [--wechat-shortcut]");
    result = 1;
  }
  CoUninitialize();
  return result;
}
