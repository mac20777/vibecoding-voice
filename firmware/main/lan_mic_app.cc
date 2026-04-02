#include "lan_mic_app.h"

#include <cJSON.h>
#include <driver/gpio.h>
#include <esp_log.h>
#include <esp_random.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <lwip/inet.h>
#include <lwip/sockets.h>
#include <mbedtls/md.h>

#include <algorithm>
#include <cmath>
#include <cerrno>
#include <cstring>
#include <cstdio>
#include <string>
#include <vector>

#include <esp_sleep.h>

#include "board.h"
#include "boards/zectrix-s3-epaper-4.2/config.h"

extern "C" void ZectrixSetFactoryLedOverride(bool enabled, bool blink);
#include "display.h"
#include "network_interface.h"
#include "settings.h"
#include "ssid_manager.h"
#include "wifi_manager.h"
#include "web_socket.h"

namespace {

#ifndef CONFIG_LAN_MIC_SERVER_URI
#define CONFIG_LAN_MIC_SERVER_URI ""
#endif
#ifndef CONFIG_LAN_DISCOVERY_ENABLED
#define CONFIG_LAN_DISCOVERY_ENABLED 1
#endif
#ifndef CONFIG_LAN_DISCOVERY_PORT
#define CONFIG_LAN_DISCOVERY_PORT 8766
#endif
#ifndef CONFIG_LAN_DISCOVERY_HOST_ID
#define CONFIG_LAN_DISCOVERY_HOST_ID ""
#endif
#ifndef CONFIG_LAN_SHARED_SECRET
#define CONFIG_LAN_SHARED_SECRET ""
#endif

constexpr char kTag[] = "LanMicApp";
constexpr char kDiscoveryService[] = "vibecoding-voice";
constexpr char kLanMicNamespace[] = "lan_mic";
constexpr char kVolumeKey[] = "volume";
constexpr char kLastServerUriKey[] = "last_srv_uri";
constexpr char kPairedHostIdKey[] = "pair_host_id";
constexpr char kPairedHostNameKey[] = "pair_host_nm";
constexpr EventBits_t kWifiConnectedBit = BIT0;
constexpr int kFrameDurationMs = 20;
constexpr int kSampleRate = 16000;
constexpr int kFrameSamples = kSampleRate * kFrameDurationMs / 1000;
constexpr size_t kPrerollFrameCount = 30;      // 600 ms @ 20 ms per frame
constexpr int kDiscoveryAttempts = 3;
constexpr int kDiscoveryTimeoutMs = 600;
constexpr int kDiscoveryRetryDelayMs = 150;
constexpr int64_t kReconnectIntervalMinMs = 2000;
constexpr int64_t kReconnectIntervalMaxMs = 60000;
constexpr int64_t kPongTimeoutMs = 45000;
constexpr uint32_t kConnectTaskStackSize = 6 * 1024;
constexpr UBaseType_t kConnectTaskPriority = 2;
// If no server connection is established within this window, enter deep sleep
// to preserve battery.  BOOT button or a 5-minute timer wakes the board for
// another retry cycle.  Pressing BOOT while disconnected resets this window.
constexpr int64_t kNoConnectionSleepMs = 5LL * 60 * 1000;  // 5 minutes
constexpr size_t kBodyCharsPerLine = 22;
constexpr size_t kPromptVisibleLines = 3;
constexpr size_t kReplyVisibleLines = 4;
constexpr size_t kLogVisibleLines = 8;
constexpr int kStatusBarBottomY = 31;
constexpr int kHeaderLineY = 62;
constexpr int kPromptDividerY = 156;
constexpr int kFooterTopY = 264;
constexpr int kContentHeaderY = 44;
constexpr int kPromptTitleY = 74;
constexpr int kPromptBodyY = 96;
constexpr int kReplyTitleY = 168;
constexpr int kReplyBodyY = 190;
constexpr int kLogTitleY = 74;
constexpr int kLogBodyY = 96;
constexpr int kFooterTextY = 276;
constexpr int kLineHeight = 18;
constexpr int kBatteryPollIntervalMs = 15000;
constexpr uint8_t kWifiIcon12x12[] = {
    0x00, 0x00,
    0x03, 0xC0,
    0x0C, 0x30,
    0x10, 0x08,
    0x03, 0xC0,
    0x04, 0x20,
    0x08, 0x10,
    0x01, 0x80,
    0x02, 0x40,
    0x00, 0x00,
    0x00, 0x00,
    0x00, 0x00,
};

constexpr uint8_t kBatteryIcon14x8[] = {
    0xFF, 0xFC,
    0x80, 0x04,
    0x80, 0x04,
    0x80, 0x04,
    0x80, 0x04,
    0x80, 0x04,
    0x80, 0x04,
    0xFF, 0xFC,
};

std::vector<std::string> WrapUtf8Lines(const std::string& text, size_t max_chars, size_t max_lines = 0) {
    std::vector<std::string> lines;
    std::string current;
    size_t current_chars = 0;
    const bool unlimited = max_lines == 0;

    auto push_line = [&]() {
        lines.push_back(current);
        current.clear();
        current_chars = 0;
    };

    for (size_t i = 0; i < text.size();) {
        const unsigned char ch = static_cast<unsigned char>(text[i]);
        size_t char_len = 1;
        if ((ch & 0x80) == 0x00) {
            char_len = 1;
        } else if ((ch & 0xE0) == 0xC0) {
            char_len = 2;
        } else if ((ch & 0xF0) == 0xE0) {
            char_len = 3;
        } else if ((ch & 0xF8) == 0xF0) {
            char_len = 4;
        }

        if (i + char_len > text.size()) {
            char_len = 1;
        }

        // Newline: flush current line without a string copy per codepoint
        if (char_len == 1 && text[i] == '\n') {
            push_line();
            i += 1;
            if (!unlimited && lines.size() >= max_lines) {
                return lines;
            }
            continue;
        }

        // Append codepoint bytes directly — avoids substr() allocation per character
        current.append(text, i, char_len);
        i += char_len;
        current_chars++;
        if (current_chars >= max_chars) {
            push_line();
            if (!unlimited && lines.size() >= max_lines) {
                return lines;
            }
        }
    }

    if (!current.empty() && (unlimited || lines.size() < max_lines)) {
        lines.push_back(current);
    }
    return lines;
}

const char* GetJsonString(cJSON* root, const char* key) {
    cJSON* item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(item) || item->valuestring == nullptr) {
        return nullptr;
    }
    return item->valuestring;
}

bool GetJsonBool(cJSON* root, const char* key, bool fallback) {
    cJSON* item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (cJSON_IsBool(item)) {
        return cJSON_IsTrue(item);
    }
    return fallback;
}

} // namespace

LanMicApp::LanMicApp()
    : board_(Board::GetInstance()),
      up_button_(TODO_UP_BUTTON_GPIO, false, 800),
      down_button_(TODO_DOWN_BUTTON_GPIO, false, 800) {
    wifi_event_group_ = xEventGroupCreate();
}

LanMicApp::~LanMicApp() {
    DisconnectWebSocket();
    if (wifi_event_group_ != nullptr) {
        vEventGroupDelete(wifi_event_group_);
    }
}

bool LanMicApp::Initialize() {
    codec_ = board_.GetAudioCodec();
    display_ = board_.GetDisplay();
    if (codec_ == nullptr) {
        ESP_LOGE(kTag, "Audio codec is null");
        return false;
    }

    ConfigureButtons();

    LoadPersistedNetworkState();
    codec_->Start();
    codec_->EnableOutput(false);
    codec_->SetOutputVolume(volume_);

    status_text_ = "Starting Wi-Fi";
    cli_status_text_ = "CLI idle";
    cli_phase_text_ = "idle";
    transcript_text_.clear();
    latest_assistant_text_.clear();
    repo_name_ = "AI";
    send_target_.clear();
    server_uri_.clear();
#if !CONFIG_LAN_DISCOVERY_ENABLED
    if (!cached_server_uri_.empty()) {
        server_uri_ = cached_server_uri_;
    } else if (std::strlen(CONFIG_LAN_MIC_SERVER_URI) > 0) {
        server_uri_ = CONFIG_LAN_MIC_SERVER_URI;
    }
#endif
    audio_frame_buffer_.resize(kFrameSamples);
    cli_log_lines_.clear();
    hint_text_ = "Hold BOOT to talk\nHold UP+DOWN for Wi-Fi";
    phase_ = Phase::Idle;
    network_state_ = NetworkState::Offline;
    RefreshBatteryStatus(true);
    UpdateDisplay();
    // Force a full e-paper refresh on startup to clear any residual image
    // from a previous firmware (e.g. factory test page)
    if (display_ != nullptr) {
        display_->RequestUrgentFullRefresh();
    }

    board_.SetNetworkEventCallback([this](NetworkEvent event, const std::string& data) {
        switch (event) {
            case NetworkEvent::Connecting:
                ESP_LOGI(kTag, "WiFi connecting: %s", data.c_str());
                network_state_ = NetworkState::Offline;
                status_text_ = "Wi-Fi connecting";
                hint_text_ = data.empty() ? "" : data;
                UpdateDisplay();
                break;
            case NetworkEvent::Connected:
                ESP_LOGI(kTag, "WiFi connected: %s", data.c_str());
                xEventGroupSetBits(wifi_event_group_, kWifiConnectedBit);
                network_state_ = NetworkState::Wifi;
                status_text_ = "Wi-Fi connected";
                server_uri_.clear();
                hint_text_ = CONFIG_LAN_DISCOVERY_ENABLED ? GetDiscoveryHintText() : "Connecting server...";
                UpdateDisplay();
                break;
            case NetworkEvent::Disconnected:
                ESP_LOGW(kTag, "WiFi disconnected");
                xEventGroupClearBits(wifi_event_group_, kWifiConnectedBit);
                network_state_ = NetworkState::Offline;
                status_text_ = "Wi-Fi disconnected";
                hint_text_ = "Check Wi-Fi\nHold UP+DOWN for setup";
                server_uri_.clear();
                DisconnectWebSocket();
                UpdateDisplay();
                break;
            case NetworkEvent::WifiConfigModeEnter:
                ESP_LOGW(kTag, "WiFi config mode: %s", data.c_str());
                network_state_ = NetworkState::Config;
                status_text_ = "Wi-Fi setup mode";
                hint_text_ = data;
                active_page_ = Page::Summary;
                summary_scroll_offset_ = 0;
                UpdateDisplay();
                break;
            case NetworkEvent::WifiConfigModeExit:
                network_state_ = IsWifiConnected() ? NetworkState::Wifi : NetworkState::Offline;
                status_text_ = "Leaving setup mode";
                hint_text_ = "Hold BOOT to talk\nHold UP+DOWN for Wi-Fi";
                UpdateDisplay();
                break;
            default:
                break;
        }
    });

    board_.StartNetwork();
    return true;
}

void LanMicApp::LoadPersistedNetworkState() {
    Settings nvs(kLanMicNamespace);
    volume_ = nvs.GetInt(kVolumeKey, 70);
    cached_server_uri_ = nvs.GetString(kLastServerUriKey, "");
    paired_host_id_ = nvs.GetString(kPairedHostIdKey, "");
    paired_host_name_ = nvs.GetString(kPairedHostNameKey, "");

    if (!paired_host_id_.empty()) {
        ESP_LOGI(kTag, "Loaded paired host: id=%s name=%s",
                 paired_host_id_.c_str(),
                 paired_host_name_.empty() ? "(unknown)" : paired_host_name_.c_str());
    }
    if (!cached_server_uri_.empty()) {
        ESP_LOGI(kTag, "Loaded cached server URI: %s", cached_server_uri_.c_str());
    }
}

void LanMicApp::SaveCachedServerUri(const std::string& server_uri) {
    if (server_uri.empty() || server_uri == cached_server_uri_) {
        return;
    }

    Settings nvs(kLanMicNamespace, true);
    nvs.SetString(kLastServerUriKey, server_uri);
    cached_server_uri_ = server_uri;
    ESP_LOGI(kTag, "Cached server URI: %s", cached_server_uri_.c_str());
}

void LanMicApp::SavePairedHost(const std::string& host_id, const std::string& host_name) {
    if (host_id.empty()) {
        return;
    }

    const std::string next_host_name = host_name.empty() ? paired_host_name_ : host_name;
    if (host_id == paired_host_id_ && next_host_name == paired_host_name_) {
        return;
    }

    Settings nvs(kLanMicNamespace, true);
    nvs.SetString(kPairedHostIdKey, host_id);
    if (!next_host_name.empty()) {
        nvs.SetString(kPairedHostNameKey, next_host_name);
    }

    paired_host_id_ = host_id;
    paired_host_name_ = next_host_name;
    ESP_LOGI(kTag, "Paired host saved: id=%s name=%s",
             paired_host_id_.c_str(),
             paired_host_name_.empty() ? "(unknown)" : paired_host_name_.c_str());
}

void LanMicApp::ClearPersistedHost() {
    Settings nvs(kLanMicNamespace, true);
    nvs.EraseKey(kLastServerUriKey);
    nvs.EraseKey(kPairedHostIdKey);
    nvs.EraseKey(kPairedHostNameKey);

    cached_server_uri_.clear();
    paired_host_id_.clear();
    paired_host_name_.clear();
    server_uri_.clear();

    ESP_LOGI(kTag, "Cleared cached host pairing and server URI");
}

void LanMicApp::ConfigureButtons() {
    gpio_config_t cfg = {};
    cfg.pin_bit_mask = 1ULL << BOOT_BUTTON_GPIO;
    cfg.mode = GPIO_MODE_INPUT;
    cfg.pull_up_en = GPIO_PULLUP_ENABLE;
    cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    cfg.intr_type = GPIO_INTR_DISABLE;
    ESP_ERROR_CHECK(gpio_config(&cfg));

    up_button_.OnClick([this]() {
        ESP_LOGI(kTag, "UP click");
        up_clicked_.store(true);
    });
    down_button_.OnClick([this]() {
        ESP_LOGI(kTag, "DOWN click");
        down_clicked_.store(true);
    });
    up_button_.OnLongPress([this]() {
        ESP_LOGI(kTag, "UP long press");
        up_long_pressed_.store(true);
    });
    down_button_.OnLongPress([this]() {
        ESP_LOGI(kTag, "DOWN long press");
        down_long_pressed_.store(true);
    });
}

bool LanMicApp::IsWifiConnected() const {
    return (xEventGroupGetBits(wifi_event_group_) & kWifiConnectedBit) != 0;
}

bool LanMicApp::IsServerConnected() const {
    return ws_ != nullptr && ws_->IsConnected();
}

void LanMicApp::StartConnectAttemptAsync() {
    if (IsServerConnected()) {
        return;
    }

    bool expected = false;
    if (!connect_attempt_running_.compare_exchange_strong(expected, true,
                                                          std::memory_order_acq_rel,
                                                          std::memory_order_acquire)) {
        return;
    }

    connect_attempt_completed_.store(false, std::memory_order_release);
    connect_cancel_requested_.store(false, std::memory_order_release);

    if (xTaskCreate([](void* arg) {
            auto* self = static_cast<LanMicApp*>(arg);
            self->RunConnectAttemptTask();
            self->connect_task_handle_ = nullptr;
            self->connect_attempt_running_.store(false, std::memory_order_release);
            self->connect_attempt_completed_.store(true, std::memory_order_release);
            vTaskDelete(nullptr);
        },
        "lan_reconnect",
        kConnectTaskStackSize,
        this,
        kConnectTaskPriority,
        &connect_task_handle_) != pdPASS) {
        connect_task_handle_ = nullptr;
        connect_attempt_running_.store(false, std::memory_order_release);
        connect_attempt_completed_.store(true, std::memory_order_release);
        status_text_ = "Reconnect error";
        hint_text_ = "Task create failed";
        UpdateDisplay();
    }
}

void LanMicApp::RunConnectAttemptTask() {
    EnsureWebSocketConnected();
    if (connect_cancel_requested_.exchange(false, std::memory_order_acq_rel) && !IsServerConnected()) {
        ws_.reset();
        hello_sent_ = false;
    }
}

bool LanMicApp::EnsureWebSocketConnected() {
    if (IsServerConnected()) {
        return true;
    }

    const char* target_uri = nullptr;
    const char* target_source = "none";
    std::string fallback_server_uri;
    if (!server_uri_.empty()) {
        target_uri = server_uri_.c_str();
        target_source = "discovery";
    } else if (!cached_server_uri_.empty()) {
        target_uri = cached_server_uri_.c_str();
        target_source = "cache";
    } else {
        DiscoverServerUri();
        if (!server_uri_.empty()) {
            target_uri = server_uri_.c_str();
            target_source = "discovery";
        }
    }

    if (target_uri == nullptr) {
        fallback_server_uri = GetFallbackServerUri();
        if (!fallback_server_uri.empty()) {
            target_uri = fallback_server_uri.c_str();
            target_source = "fallback";
        }
    }

    if (target_uri == nullptr) {
        status_text_ = "Finding host";
        hint_text_ = GetDiscoveryHintText();
        UpdateDisplay();
        return false;
    }

    NetworkInterface* network = board_.GetNetwork();
    if (network == nullptr) {
        ESP_LOGE(kTag, "Network interface is null");
        return false;
    }

    const std::string target_uri_text = target_uri;
    ESP_LOGI(kTag, "Connecting via %s: %s", target_source, target_uri_text.c_str());

    ws_ = network->CreateWebSocket(0);
    ws_->OnConnected([this, target_uri_text]() {
        ESP_LOGI(kTag, "WebSocket connected");
        SaveCachedServerUri(target_uri_text);
        network_state_ = NetworkState::Server;
        status_text_ = "Connected";
        hint_text_ = "";  // BuildPromptBody() will show "Hold BOOT to talk"
        phase_ = Phase::Idle;
        UpdateDisplay();
        if (display_ != nullptr) {
            display_->RequestUrgentFullRefresh();
        }
    });
    ws_->OnDisconnected([this]() {
        ESP_LOGW(kTag, "WebSocket disconnected");
        ws_disconnected_pending_.store(true);
    });
    ws_->OnError([this](int error) {
        ESP_LOGW(kTag, "WebSocket error=%d", error);
        network_state_ = IsWifiConnected() ? NetworkState::Wifi : NetworkState::Offline;
        status_text_ = "Server error";
        hint_text_ = "Will retry automatically";
        phase_ = Phase::Error;
        UpdateDisplay();
    });
    ws_->OnData([this](const char* data, size_t len, bool binary) {
        if (!binary && data != nullptr && len > 0) {
            HandleServerMessage(data, len);
        }
    });

    if (!ws_->Connect(target_uri)) {
        ESP_LOGW(kTag, "WebSocket connect failed: %s", target_uri);
        ws_.reset();
        hello_sent_ = false;
        if (std::strcmp(target_source, "cache") == 0) {
            ESP_LOGW(kTag, "Cache connect failed, clearing in-memory cache and retrying discovery next round");
            cached_server_uri_.clear();
        }
        status_text_ = "Connect failed";
        hint_text_ = target_uri;
        UpdateDisplay();
        return false;
    }

    hello_sent_ = false;
    return SendHello();
}

bool LanMicApp::DiscoverServerUri() {
#if !CONFIG_LAN_DISCOVERY_ENABLED
    return false;
#else
    if (!IsWifiConnected()) {
        return false;
    }

    // Skip re-discovery if we already have a URI from a previous successful discovery.
    if (!server_uri_.empty()) {
        return true;
    }

    const std::string expected_host_id = GetExpectedDiscoveryHostId();
    cJSON* request = cJSON_CreateObject();
    const std::string nonce = MakeAuthNonce();
    cJSON_AddStringToObject(request, "type", "discover_host");
    cJSON_AddStringToObject(request, "service", kDiscoveryService);
    cJSON_AddStringToObject(request, "deviceId", board_.GetUuid().c_str());
    cJSON_AddStringToObject(request, "boardType", board_.GetBoardType().c_str());
    cJSON_AddStringToObject(request, "nonce", nonce.c_str());
    if (!expected_host_id.empty()) {
        cJSON_AddStringToObject(request, "expectedHostId", expected_host_id.c_str());
    }

    char* request_text = cJSON_PrintUnformatted(request);
    cJSON_Delete(request);
    if (request_text == nullptr) {
        return false;
    }

    for (int attempt = 0; attempt < kDiscoveryAttempts; ++attempt) {
        int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (sock < 0) {
            ESP_LOGW(kTag, "Discovery socket create failed: errno=%d", errno);
            break;
        }

        int broadcast = 1;
        setsockopt(sock, SOL_SOCKET, SO_BROADCAST, &broadcast, sizeof(broadcast));
        struct sockaddr_in local_addr = {};
        local_addr.sin_family = AF_INET;
        local_addr.sin_port = htons(0);
        local_addr.sin_addr.s_addr = htonl(INADDR_ANY);
        if (bind(sock,
                 reinterpret_cast<struct sockaddr*>(&local_addr),
                 sizeof(local_addr)) < 0) {
            ESP_LOGW(kTag, "Discovery bind failed: errno=%d", errno);
            close(sock);
            continue;
        }

        struct sockaddr_in broadcast_addr = {};
        broadcast_addr.sin_family = AF_INET;
        broadcast_addr.sin_port = htons(CONFIG_LAN_DISCOVERY_PORT);
        broadcast_addr.sin_addr.s_addr = inet_addr("255.255.255.255");

        ESP_LOGI(kTag, "Discovery attempt %d/%d", attempt + 1, kDiscoveryAttempts);
        const int sent = sendto(sock,
                                request_text,
                                std::strlen(request_text),
                                0,
                                reinterpret_cast<struct sockaddr*>(&broadcast_addr),
                                sizeof(broadcast_addr));
        if (sent < 0) {
            ESP_LOGW(kTag, "Discovery broadcast failed: errno=%d", errno);
            close(sock);
            continue;
        }

        const int64_t deadline_us = esp_timer_get_time() + (kDiscoveryTimeoutMs * 1000LL);
        while (esp_timer_get_time() < deadline_us) {
            const int64_t remaining_us = deadline_us - esp_timer_get_time();
            if (remaining_us <= 0) {
                break;
            }

            struct timeval timeout = {};
            timeout.tv_sec = remaining_us / 1000000;
            timeout.tv_usec = remaining_us % 1000000;
            setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));

            char response_buffer[512];
            struct sockaddr_in source_addr = {};
            socklen_t source_addr_len = sizeof(source_addr);
            const int received = recvfrom(sock,
                                          response_buffer,
                                          sizeof(response_buffer) - 1,
                                          0,
                                          reinterpret_cast<struct sockaddr*>(&source_addr),
                                          &source_addr_len);
            if (received <= 0) {
                continue;
            }

            response_buffer[received] = '\0';
            cJSON* response = cJSON_Parse(response_buffer);
            if (response == nullptr) {
                continue;
            }

            const char* type = GetJsonString(response, "type");
            const char* service = GetJsonString(response, "service");
            const char* ws_url = GetJsonString(response, "wsUrl");
            const char* host_id = GetJsonString(response, "hostId");
            const char* host_name = GetJsonString(response, "hostName");
            const char* reply_nonce = GetJsonString(response, "nonce");
            const char* auth_sig = GetJsonString(response, "authSig");

            const bool type_ok = type != nullptr && strcmp(type, "discover_reply") == 0;
            const bool service_ok = service == nullptr || strcmp(service, kDiscoveryService) == 0;
            const bool host_ok = expected_host_id.empty() ||
                                 (host_id != nullptr && expected_host_id == host_id);
            bool auth_ok = true;
            if (std::strlen(CONFIG_LAN_SHARED_SECRET) > 0) {
                if (reply_nonce == nullptr || auth_sig == nullptr || nonce != reply_nonce) {
                    auth_ok = false;
                } else {
                    const auto expected = HmacSha256Hex({
                        "discover_reply",
                        host_id != nullptr ? host_id : "",
                        host_name != nullptr ? host_name : "",
                        ws_url != nullptr ? ws_url : "",
                        reply_nonce
                    });
                    auth_ok = !expected.empty() && expected == std::string(auth_sig);
                }
            }

            if (type_ok && service_ok && host_ok && auth_ok && ws_url != nullptr && ws_url[0] != '\0') {
                server_uri_ = ws_url;
                SaveCachedServerUri(server_uri_);
                SavePairedHost(host_id != nullptr ? host_id : "",
                               host_name != nullptr ? host_name : "");
                status_text_ = "Host discovered";
                hint_text_ = (host_name != nullptr && host_name[0] != '\0') ? host_name : server_uri_;
                ESP_LOGI(kTag, "Discovered host: %s (%s)", server_uri_.c_str(), hint_text_.c_str());
                cJSON_Delete(response);
                close(sock);
                cJSON_free(request_text);
                return true;
            }

            cJSON_Delete(response);
        }

        close(sock);
        if (attempt + 1 < kDiscoveryAttempts) {
            vTaskDelay(pdMS_TO_TICKS(kDiscoveryRetryDelayMs));
        }
    }

    cJSON_free(request_text);
    return false;
#endif
}

std::string LanMicApp::MakeAuthNonce() const {
    uint8_t bytes[8] = {0};
    esp_fill_random(bytes, sizeof(bytes));
    char buffer[sizeof(bytes) * 2 + 1];
    for (size_t index = 0; index < sizeof(bytes); ++index) {
        snprintf(buffer + (index * 2), sizeof(buffer) - (index * 2), "%02x", bytes[index]);
    }
    buffer[sizeof(buffer) - 1] = '\0';
    return std::string(buffer);
}

std::string LanMicApp::HmacSha256Hex(const std::vector<std::string>& parts) const {
    if (std::strlen(CONFIG_LAN_SHARED_SECRET) == 0) {
        return "";
    }

    std::string payload;
    for (size_t index = 0; index < parts.size(); ++index) {
        if (index > 0) {
            payload.push_back('|');
        }
        payload += parts[index];
    }

    const mbedtls_md_info_t* md_info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (md_info == nullptr) {
        return "";
    }

    unsigned char digest[32] = {0};
    const int ret = mbedtls_md_hmac(
        md_info,
        reinterpret_cast<const unsigned char*>(CONFIG_LAN_SHARED_SECRET),
        std::strlen(CONFIG_LAN_SHARED_SECRET),
        reinterpret_cast<const unsigned char*>(payload.data()),
        payload.size(),
        digest);
    if (ret != 0) {
        ESP_LOGW(kTag, "HMAC failed: %d", ret);
        return "";
    }

    char hex[65];
    for (size_t index = 0; index < sizeof(digest); ++index) {
        snprintf(hex + (index * 2), sizeof(hex) - (index * 2), "%02x", digest[index]);
    }
    hex[64] = '\0';
    return std::string(hex);
}

std::string LanMicApp::GetExpectedDiscoveryHostId() const {
    if (std::strlen(CONFIG_LAN_DISCOVERY_HOST_ID) > 0) {
        return CONFIG_LAN_DISCOVERY_HOST_ID;
    }
    return paired_host_id_;
}

std::string LanMicApp::GetFallbackServerUri() const {
    if (std::strlen(CONFIG_LAN_MIC_SERVER_URI) == 0) {
        return "";
    }
    return CONFIG_LAN_MIC_SERVER_URI;
}

std::string LanMicApp::GetDiscoveryHintText() const {
    if (!paired_host_name_.empty()) {
        return "Finding " + paired_host_name_ + "...";
    }
    if (!paired_host_id_.empty()) {
        return "Finding paired host...";
    }
    return "Discovering host...";
}

void LanMicApp::EnterWifiSetupMode() {
    ESP_LOGW(kTag, "Clearing saved Wi-Fi and entering config mode");
    ClearPersistedHost();
    DisconnectWebSocket();
    xEventGroupClearBits(wifi_event_group_, kWifiConnectedBit);
    up_long_pressed_.store(false);
    down_long_pressed_.store(false);
    has_pending_transcript_ = false;
    phase_ = Phase::Idle;
    network_state_ = NetworkState::Config;
    active_page_ = Page::Summary;
    summary_scroll_offset_ = 0;
    status_text_ = "Wi-Fi setup";
    hint_text_ = "Starting config AP...";
    UpdateDisplay();

    SsidManager::GetInstance().Clear();
    WifiManager::GetInstance().StartConfigAp();
}

void LanMicApp::DisconnectWebSocket() {
    if (connect_attempt_running_.load(std::memory_order_acquire) && !IsServerConnected()) {
        connect_cancel_requested_.store(true, std::memory_order_release);
    } else if (ws_ != nullptr) {
        ws_.reset();
    }
    hello_sent_ = false;
    preroll_frames_.clear();
}

bool LanMicApp::IsPttPressed() const {
    return gpio_get_level(BOOT_BUTTON_GPIO) == 0;
}

bool LanMicApp::IsNavButtonPressed(gpio_num_t gpio_num) const {
    return gpio_get_level(gpio_num) == 0;
}

bool LanMicApp::SendJson(const char* json) {
    if (ws_ == nullptr || !ws_->IsConnected()) {
        return false;
    }
    if (!ws_->Send(json)) {
        ESP_LOGW(kTag, "Failed to send json: %s", json);
        DisconnectWebSocket();
        return false;
    }
    return true;
}

bool LanMicApp::SendHello() {
    if (hello_sent_) {
        return true;
    }

    const int64_t auth_ts = esp_timer_get_time() / 1000;
    const std::string auth_nonce = MakeAuthNonce();
    const std::string auth_sig = HmacSha256Hex({
        "hello",
        board_.GetUuid(),
        board_.GetBoardType(),
        std::to_string(auth_ts),
        auth_nonce
    });

    char message[512];
    if (!auth_sig.empty()) {
        snprintf(message,
                 sizeof(message),
                 "{\"type\":\"hello\",\"deviceId\":\"%s\",\"boardType\":\"%s\",\"authTs\":%lld,\"authNonce\":\"%s\",\"authSig\":\"%s\"}",
                 board_.GetUuid().c_str(),
                 board_.GetBoardType().c_str(),
                 static_cast<long long>(auth_ts),
                 auth_nonce.c_str(),
                 auth_sig.c_str());
    } else {
        snprintf(message,
                 sizeof(message),
                 "{\"type\":\"hello\",\"deviceId\":\"%s\",\"boardType\":\"%s\"}",
                 board_.GetUuid().c_str(),
                 board_.GetBoardType().c_str());
    }
    hello_sent_ = SendJson(message);
    return hello_sent_;
}

bool LanMicApp::SendPttStart() {
    char message[128];
    snprintf(message,
             sizeof(message),
             "{\"type\":\"ptt_start\",\"ts\":%lld}",
             static_cast<long long>(esp_timer_get_time() / 1000));
    return SendJson(message);
}

bool LanMicApp::SendPttStop() {
    char message[128];
    snprintf(message,
             sizeof(message),
             "{\"type\":\"ptt_stop\",\"ts\":%lld}",
             static_cast<long long>(esp_timer_get_time() / 1000));
    return SendJson(message);
}

bool LanMicApp::SendAction(const char* action_type) {
    char message[128];
    snprintf(message,
             sizeof(message),
             "{\"type\":\"%s\",\"ts\":%lld}",
             action_type,
             static_cast<long long>(esp_timer_get_time() / 1000));
    return SendJson(message);
}

bool LanMicApp::StreamAudioFrame() {
    if (ws_ == nullptr || !ws_->IsConnected()) {
        return false;
    }

    if (!codec_->InputData(audio_frame_buffer_)) {
        return false;
    }

    if (!ws_->Send(audio_frame_buffer_.data(), audio_frame_buffer_.size() * sizeof(int16_t), true)) {
        ESP_LOGW(kTag, "Failed to send audio frame");
        DisconnectWebSocket();
        return false;
    }

    return true;
}

void LanMicApp::CapturePrerollFrame() {
    if (codec_ == nullptr) {
        return;
    }

    std::vector<int16_t> frame(kFrameSamples);
    if (!codec_->InputData(frame)) {
        return;
    }

    if (preroll_frames_.size() >= kPrerollFrameCount) {
        preroll_frames_.pop_front();
    }
    preroll_frames_.push_back(std::move(frame));
}

bool LanMicApp::FlushPrerollFrames() {
    if (ws_ == nullptr || !ws_->IsConnected()) {
        preroll_frames_.clear();
        return false;
    }

    while (!preroll_frames_.empty()) {
        auto& frame = preroll_frames_.front();
        if (!ws_->Send(frame.data(), frame.size() * sizeof(int16_t), true)) {
            ESP_LOGW(kTag, "Failed to send preroll frame");
            preroll_frames_.clear();
            DisconnectWebSocket();
            return false;
        }
        preroll_frames_.pop_front();
    }

    return true;
}

void LanMicApp::HandleServerMessage(const char* data, size_t len) {
    std::string text(data, len);
    ESP_LOGI(kTag, "Server: %s", text.c_str());

    cJSON* root = cJSON_ParseWithLength(data, len);
    if (root == nullptr) {
        ESP_LOGW(kTag, "Failed to parse server json");
        return;
    }

    const char* type = GetJsonString(root, "type");
    if (type == nullptr) {
        cJSON_Delete(root);
        return;
    }

    if (strcmp(type, "hello_ack") == 0) {
        status_text_ = "Ready";
        if (!has_pending_transcript_) {
            phase_ = Phase::Idle;
        }
        // 连上服务器：上升双音
        PlayBeep(600, 80);
        PlayBeep(900, 100);
    } else if (strcmp(type, "server_ready") == 0) {
        status_text_ = "Ready";
        if (!has_pending_transcript_) {
            phase_ = Phase::Idle;
        }
        const char* send_target = GetJsonString(root, "sendTarget");
        if (send_target != nullptr) {
            send_target_ = send_target;
            cli_status_text_ = std::string(GetToolLabel()) + " idle";
            if (repo_name_ == "AI") {
                repo_name_ = GetToolLabel();
            }
        }
    } else if (strcmp(type, "status") == 0) {
        const char* status = GetJsonString(root, "status");
        const char* text_value = GetJsonString(root, "text");
        if (status != nullptr) {
            if (strcmp(status, "recording") == 0) {
                phase_ = Phase::Recording;
                status_text_ = "Recording";
            } else if (strcmp(status, "transcribing") == 0) {
                phase_ = Phase::Transcribing;
                status_text_ = "Transcribing";
                PlayBeep(660, 80);   // 停止录音/转录中：短低音
            } else if (strcmp(status, "awaiting_action") == 0) {
                phase_ = Phase::AwaitingAction;
                status_text_ = "Ready to send";
                has_pending_transcript_ = true;
                active_page_ = Page::Summary;
                summary_scroll_offset_ = 0;
            } else if (strcmp(status, "typed") == 0) {
                phase_ = Phase::Running;
                status_text_ = "Sent";
                has_pending_transcript_ = false;
                active_page_ = Page::Summary;
            } else if (strcmp(status, "undo_ok") == 0) {
                phase_ = Phase::Idle;
                status_text_ = "Canceled";
                has_pending_transcript_ = false;
            } else if (strcmp(status, "transcript_empty") == 0 || strcmp(status, "empty_segment") == 0) {
                if (text_value != nullptr && text_value[0] != '\0') {
                    phase_ = Phase::AwaitingAction;
                    status_text_ = "No speech added";
                    has_pending_transcript_ = true;
                    transcript_text_ = text_value;
                    active_page_ = Page::Summary;
                } else {
                    phase_ = Phase::Idle;
                    status_text_ = "No speech detected";
                    hint_text_ = "Try again";
                    has_pending_transcript_ = false;
                    transcript_text_.clear();
                }
            } else if (strcmp(status, "no_pending") == 0) {
                phase_ = Phase::Idle;
                status_text_ = "Nothing pending";
            } else if (strcmp(status, "cli_busy") == 0) {
                phase_ = Phase::Running;
                status_text_ = std::string(GetToolLabel()) + " busy";
            } else {
                status_text_ = status;
            }
        }
        if (text_value != nullptr) {
            transcript_text_ = text_value;
        }
    } else if (strcmp(type, "transcript_final") == 0) {
        const char* text_value = GetJsonString(root, "text");
        if (text_value != nullptr) {
            transcript_text_ = text_value;
        }
        has_pending_transcript_ = GetJsonBool(root, "requiresAction", false);
        phase_ = has_pending_transcript_ ? Phase::AwaitingAction : Phase::Idle;
        status_text_ = has_pending_transcript_ ? "Ready to send" : "Transcript ready";
        active_page_ = Page::Summary;
        summary_scroll_offset_ = 0;
    } else if (strcmp(type, "transcript_cleared") == 0) {
        transcript_text_.clear();
        has_pending_transcript_ = false;
        phase_ = Phase::Idle;
        status_text_ = "Cleared";
    } else if (strcmp(type, "cli_session_state") == 0) {
        const char* phase = GetJsonString(root, "phase");
        const char* status_line = GetJsonString(root, "statusLine");
        const char* repo_name = GetJsonString(root, "repoName");
        cJSON* quota_5h = cJSON_GetObjectItemCaseSensitive(root, "quota5hRemainingPct");
        cJSON* quota_week = cJSON_GetObjectItemCaseSensitive(root, "quotaWeekRemainingPct");
        if (phase != nullptr) {
            const bool was_running = (phase_ == Phase::Running);
            cli_phase_text_ = phase;
            if (strcmp(phase, "running") == 0) {
                phase_ = Phase::Running;
            } else if (strcmp(phase, "error") == 0) {
                phase_ = Phase::Error;
                PlayBeep(300, 300);  // 出错：低沉长音
            } else if (!has_pending_transcript_) {
                phase_ = Phase::Idle;
                if (was_running) {
                    // AI 回复完成：上升双音
                    PlayBeep(800, 80);
                    PlayBeep(1000, 100);
                }
            }
        }
        if (status_line != nullptr) {
            cli_status_text_ = status_line;
        } else if (phase != nullptr) {
            cli_status_text_ = phase;
        }
        if (repo_name != nullptr) {
            repo_name_ = repo_name;
        }
        if (cJSON_IsNumber(quota_5h)) {
            quota_5h_remaining_pct_ = quota_5h->valueint;
        }
        if (cJSON_IsNumber(quota_week)) {
            quota_week_remaining_pct_ = quota_week->valueint;
        }
    } else if (strcmp(type, "cli_summary") == 0) {
        const char* latest_user = GetJsonString(root, "latestUserText");
        const char* latest_assistant = GetJsonString(root, "latestAssistantText");
        const char* status_line = GetJsonString(root, "statusLine");
        const char* repo_name = GetJsonString(root, "repoName");
        if (latest_user != nullptr) {
            transcript_text_ = latest_user;
        }
        if (latest_assistant != nullptr) {
            latest_assistant_text_ = latest_assistant;
            summary_scroll_offset_ = 0;
        }
        if (status_line != nullptr) {
            cli_status_text_ = status_line;
        }
        if (repo_name != nullptr) {
            repo_name_ = repo_name;
        }
        active_page_ = Page::Summary;
    } else if (strcmp(type, "cli_log_tail") == 0) {
        cJSON* lines = cJSON_GetObjectItemCaseSensitive(root, "lines");
        if (cJSON_IsArray(lines)) {
            cli_log_lines_.clear();
            cJSON* line = nullptr;
            cJSON_ArrayForEach(line, lines) {
                if (cJSON_IsString(line) && line->valuestring != nullptr) {
                    cli_log_lines_.push_back(line->valuestring);
                }
            }
            std::vector<std::string> wrapped;
            for (const auto& item : cli_log_lines_) {
                const auto item_lines = WrapText(item, kBodyCharsPerLine);
                wrapped.insert(wrapped.end(), item_lines.begin(), item_lines.end());
            }
            log_scroll_offset_ = std::max(0, static_cast<int>(wrapped.size()) - static_cast<int>(kLogVisibleLines));
        }
    } else if (strcmp(type, "error") == 0) {
        const char* error = GetJsonString(root, "error");
        phase_ = Phase::Error;
        status_text_ = "Error";
        hint_text_ = (error != nullptr) ? error : "Unknown error";
    } else if (strcmp(type, "warning") == 0) {
        const char* warning = GetJsonString(root, "warning");
        status_text_ = "Warning";
        hint_text_ = (warning != nullptr) ? warning : "";
    }

    cJSON_Delete(root);
    UpdateDisplay();
}

void LanMicApp::RefreshBatteryStatus(bool force_update) {
    int level = 0;
    bool charging = false;
    bool discharging = false;
    const bool ok = board_.GetBatteryLevel(level, charging, discharging);
    const bool changed = (!battery_known_ && ok) ||
                         battery_level_ != level ||
                         battery_charging_ != charging ||
                         battery_discharging_ != discharging;

    battery_known_ = ok;
    battery_level_ = level;
    battery_charging_ = charging;
    battery_discharging_ = discharging;
    if (!force_update && changed) {
        UpdateDisplay();
    }
}

void LanMicApp::HandleScroll(int direction) {
    if (direction == 0) {
        return;
    }

    // Clamp and update offset, then let UpdateDisplay() do the single wrap computation.
    if (active_page_ == Page::Summary) {
        const int next_offset = summary_scroll_offset_ + direction;
        if (next_offset != summary_scroll_offset_ && next_offset >= 0) {
            summary_scroll_offset_ = next_offset;
            UpdateDisplay();
        }
        return;
    }

    const int next_offset = log_scroll_offset_ + direction;
    if (next_offset != log_scroll_offset_ && next_offset >= 0) {
        log_scroll_offset_ = next_offset;
        UpdateDisplay();
    }
}

void LanMicApp::SwitchPage(Page page) {
    if (has_pending_transcript_ || active_page_ == page) {
        return;
    }
    active_page_ = page;
    settings_editing_volume_ = false;
    UpdateDisplay();
}

void LanMicApp::EnterSettings() {
    if (has_pending_transcript_) {
        return;
    }
    if (active_page_ != Page::Settings) {
        active_page_ = Page::Settings;
        settings_selected_item_ = 0;
        settings_editing_volume_ = false;
        UpdateDisplay();
    }
}

void LanMicApp::SaveVolume() {
    Settings nvs(kLanMicNamespace, true);
    nvs.SetInt(kVolumeKey, volume_);
}

void LanMicApp::Shutdown() {
    DisconnectWebSocket();
    status_text_ = "Power off...";
    hint_text_ = "Press BOOT to wake";
    active_page_ = Page::Summary;
    UpdateDisplay();
    vTaskDelay(pdMS_TO_TICKS(800));
    esp_sleep_enable_ext0_wakeup(static_cast<gpio_num_t>(BOOT_BUTTON_GPIO), 0);
    esp_deep_sleep_start();
}

void LanMicApp::HandleSettingsInput(bool up_click, bool down_click, bool boot_press) {
    if (settings_editing_volume_) {
        if (up_click) {
            volume_ = std::min(100, volume_ + 10);
            codec_->SetOutputVolume(volume_);
            UpdateDisplay();
        } else if (down_click) {
            volume_ = std::max(0, volume_ - 10);
            codec_->SetOutputVolume(volume_);
            UpdateDisplay();
        } else if (boot_press) {
            SaveVolume();
            settings_editing_volume_ = false;
            UpdateDisplay();
        }
        return;
    }

    if (up_click) {
        if (settings_selected_item_ > 0) {
            settings_selected_item_--;
            UpdateDisplay();
        }
    } else if (down_click) {
        if (settings_selected_item_ < kSettingsItemCount - 1) {
            settings_selected_item_++;
            UpdateDisplay();
        }
    } else if (boot_press) {
        ExecuteSettingsItem(settings_selected_item_);
    }
}

void LanMicApp::ExecuteSettingsItem(int item) {
    switch (item) {
        case kSettingsItemVolume:
            settings_editing_volume_ = true;
            UpdateDisplay();
            break;
        case kSettingsItemWifi:
            EnterWifiSetupMode();
            break;
        case kSettingsItemRestart:
            status_text_ = "Restarting...";
            UpdateDisplay();
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();
            break;
        case kSettingsItemPowerOff:
            Shutdown();
            break;
        default:
            break;
    }
}

const char* LanMicApp::GetNetworkLabel() const {
    switch (network_state_) {
        case NetworkState::Server:
            return "Online";
        case NetworkState::Wifi:
            return "No Srv";
        case NetworkState::Config:
            return "AP";
        case NetworkState::Offline:
        default:
            return "Offline";
    }
}

const char* LanMicApp::GetToolLabel() const {
    if (send_target_ == "claude_code") {
        return "Claude";
    }
    if (send_target_ == "text_injector") {
        return "Inject";
    }
    return "Codex";
}

std::string LanMicApp::GetPhaseLabel() const {
    switch (phase_) {
        case Phase::Recording:
            return "● REC";
        case Phase::Transcribing:
            return "... STT";
        case Phase::AwaitingAction:
            return "? Send?";
        case Phase::Running:
            return "▶ AI";
        case Phase::Error:
            return "! ERR";
        case Phase::Idle:
        default:
            return "";
    }
}

std::string LanMicApp::GetFooterText() const {
    if (has_pending_transcript_) {
        return "BOOT Add | UP Send | DN Undo";
    }
    if (phase_ == Phase::Recording) {
        return "Release BOOT to stop";
    }
    if (network_state_ == NetworkState::Config) {
        return "Join AP then open 192.168.4.1";
    }
    if (active_page_ == Page::Settings) {
        return settings_editing_volume_ ? "UP/DN ±10 | BOOT Save"
                                        : "UP/DN Nav | BOOT OK | HoldUP Back";
    }
    if (active_page_ == Page::Summary) {
        return "BOOT Talk | Hold DN Log | U+D WiFi";
    }
    return "UP/DN Scroll | Hold UP | HoldDN Set";
}

std::string LanMicApp::BuildPromptBody() const {
    if (!transcript_text_.empty()) {
        return transcript_text_;
    }
    if (!hint_text_.empty()) {
        return hint_text_;
    }
    // Default hint based on connection state
    switch (network_state_) {
        case NetworkState::Server:
            return "Hold BOOT to talk";
        case NetworkState::Wifi:
            return "Finding server...";
        case NetworkState::Config:
            return "Open 192.168.4.1";
        case NetworkState::Offline:
        default:
            return "Connecting WiFi...";
    }
}

std::string LanMicApp::BuildReplyBody() const {
    if (!latest_assistant_text_.empty()) {
        return latest_assistant_text_;
    }
    if (!cli_status_text_.empty()) {
        return cli_status_text_;
    }
    return "No CLI response yet";
}

std::vector<std::string> LanMicApp::WrapText(const std::string& text, size_t max_chars) const {
    return WrapUtf8Lines(text, max_chars, 0);
}

std::vector<std::string> LanMicApp::SliceLines(const std::vector<std::string>& lines, int offset, size_t max_lines) const {
    std::vector<std::string> visible;
    if (lines.empty()) {
        return visible;
    }

    const int clamped_offset = std::max(0, offset);
    const size_t start = static_cast<size_t>(clamped_offset);
    const size_t end = std::min(lines.size(), start + max_lines);
    for (size_t i = start; i < end; ++i) {
        visible.push_back(lines[i]);
    }
    return visible;
}

void LanMicApp::UpdateLed() {
    switch (phase_) {
        case Phase::Recording:
        case Phase::Error:
            ZectrixSetFactoryLedOverride(true, true);   // fast blink: active / error
            break;
        case Phase::Transcribing:
        case Phase::Running:
        case Phase::AwaitingAction:
            ZectrixSetFactoryLedOverride(true, false);  // solid on: processing
            break;
        case Phase::Idle:
        default:
            ZectrixSetFactoryLedOverride(false, false); // release override: charging handles LED naturally
            break;
    }
}

void LanMicApp::PlayBeep(int freq_hz, int duration_ms) {
    if (codec_ == nullptr || freq_hz <= 0 || duration_ms <= 0) {
        return;
    }
    const int sample_rate = codec_->output_sample_rate() > 0 ? codec_->output_sample_rate() : 16000;
    const int num_samples = sample_rate * duration_ms / 1000;
    if (num_samples <= 0) {
        return;
    }
    const int fade = std::min(num_samples / 4, sample_rate * 8 / 1000);
    const double step = 2.0 * M_PI * freq_hz / sample_rate;
    constexpr double kAmplitude = 10000.0;

    std::vector<int16_t> pcm(num_samples);
    for (int i = 0; i < num_samples; i++) {
        double s = std::sin(step * i) * kAmplitude;
        if (i < fade) {
            s *= static_cast<double>(i) / fade;
        } else if (i > num_samples - fade) {
            s *= static_cast<double>(num_samples - i) / fade;
        }
        pcm[i] = static_cast<int16_t>(s);
    }
    codec_->EnableOutput(true);
    codec_->OutputData(pcm);
}

void LanMicApp::DrawHorizontalLine(int y, int thickness) {
    if (display_ == nullptr || thickness <= 0) {
        return;
    }

    const int width = display_->width();
    const int bytes_per_row = (width + 7) >> 3;
    std::vector<uint8_t> buffer(bytes_per_row * thickness, 0xFF);
    display_->WriteRaw1bpp(0, y, width, thickness, buffer.data(), buffer.size());
}

void LanMicApp::DrawWifiIcon(int x, int y) {
    if (display_ == nullptr) {
        return;
    }
    display_->WriteRaw1bpp(x, y, 12, 12, kWifiIcon12x12, sizeof(kWifiIcon12x12));
}

void LanMicApp::DrawBatteryIcon(int x, int y, int level, bool charging) {
    if (display_ == nullptr) {
        return;
    }

    std::vector<uint8_t> buffer(kBatteryIcon14x8, kBatteryIcon14x8 + sizeof(kBatteryIcon14x8));
    const int fill_columns = std::clamp((level * 10) / 100, 0, 10);
    for (int row = 1; row <= 6; ++row) {
        for (int col = 1; col <= fill_columns; ++col) {
            const int bit_index = row * 16 + col;
            buffer[bit_index >> 3] |= static_cast<uint8_t>(1U << (7 - (bit_index & 7)));
        }
    }
    if (charging) {
        for (int row = 2; row <= 5; ++row) {
            const int bit_index = row * 16 + 5;
            buffer[bit_index >> 3] |= static_cast<uint8_t>(1U << (7 - (bit_index & 7)));
        }
        for (int col = 4; col <= 6; ++col) {
            const int bit_index = 4 * 16 + col;
            buffer[bit_index >> 3] |= static_cast<uint8_t>(1U << (7 - (bit_index & 7)));
        }
    }
    display_->WriteRaw1bpp(x, y, 14, 8, buffer.data(), buffer.size());
}

void LanMicApp::UpdateDisplay() {
    if (display_ == nullptr) {
        return;
    }

    std::vector<Display::TextItem> texts;
    auto single_line = [](const std::string& value, size_t max_chars) -> std::string {
        const auto lines = WrapUtf8Lines(value, max_chars, 1);
        return lines.empty() ? std::string() : lines.front();
    };

    std::string battery_text = "--";
    if (battery_known_) {
        battery_text = std::to_string(std::clamp(battery_level_, 0, 100));
        if (battery_charging_) {
            battery_text += "+";
        }
    }

    std::string quota_status_text;
    if (quota_5h_remaining_pct_ >= 0 || quota_week_remaining_pct_ >= 0) {
        const std::string q5 = quota_5h_remaining_pct_ >= 0 ? std::to_string(std::clamp(quota_5h_remaining_pct_, 0, 100)) : "--";
        const std::string qw = quota_week_remaining_pct_ >= 0 ? std::to_string(std::clamp(quota_week_remaining_pct_, 0, 100)) : "--";
        quota_status_text = "5H:" + q5 + " 7d:" + qw;
    }

    texts.push_back({GetNetworkLabel(), 28, 9, 16});
    texts.push_back({GetPhaseLabel(), 166, 9, 16});
    if (!quota_status_text.empty()) {
        texts.push_back({quota_status_text, 250, 9, 16});
    }
    texts.push_back({battery_text, 346, 9, 16});
    const char* page_label = active_page_ == Page::Summary ? "Summary"
                           : active_page_ == Page::Log     ? "Log"
                           :                                 "Settings";
    texts.push_back({single_line(repo_name_.empty() ? "Codex" : repo_name_, 18), 12, kContentHeaderY, 16});
    texts.push_back({page_label, 316, kContentHeaderY, 16});

    if (active_page_ == Page::Summary) {
        // Derive a readable status: phase takes priority, else connection state
        std::string status_display;
        if (phase_ == Phase::Recording || phase_ == Phase::Transcribing ||
            phase_ == Phase::AwaitingAction || phase_ == Phase::Running || phase_ == Phase::Error) {
            status_display = status_text_;
        } else if (network_state_ != NetworkState::Server) {
            status_display = GetNetworkLabel();
        } else {
            status_display = status_text_.empty() ? "Ready" : status_text_;
        }
        texts.push_back({"Prompt", 12, kPromptTitleY, 16});
        texts.push_back({single_line(status_display, 16), 228, kPromptTitleY, 16});

        const auto prompt_lines = SliceLines(WrapText(BuildPromptBody(), kBodyCharsPerLine), 0, kPromptVisibleLines);
        int y = kPromptBodyY;
        for (const auto& line : prompt_lines) {
            texts.push_back({line, 12, y, 16});
            y += kLineHeight;
        }

        texts.push_back({"Reply", 12, kReplyTitleY, 16});
        texts.push_back({single_line(cli_status_text_.empty() ? std::string(GetToolLabel()) + " idle" : cli_status_text_, 16), 228, kReplyTitleY, 16});

        const auto reply_lines = WrapText(BuildReplyBody(), kBodyCharsPerLine);
        const int summary_offset = std::clamp(
            summary_scroll_offset_,
            0,
            std::max(0, static_cast<int>(reply_lines.size()) - static_cast<int>(kReplyVisibleLines)));
        const auto assistant_lines = SliceLines(reply_lines, summary_offset, kReplyVisibleLines);
        y = kReplyBodyY;
        for (const auto& line : assistant_lines) {
            texts.push_back({line, 12, y, 16});
            y += kLineHeight;
        }
    } else if (active_page_ == Page::Log) {
        texts.push_back({"Log", 12, kLogTitleY, 16});
        texts.push_back({single_line(cli_status_text_.empty() ? std::string(GetToolLabel()) + " idle" : cli_status_text_, 16), 228, kLogTitleY, 16});

        std::vector<std::string> wrapped;
        for (const auto& item : cli_log_lines_) {
            const auto lines = WrapText(item, kBodyCharsPerLine);
            wrapped.insert(wrapped.end(), lines.begin(), lines.end());
        }
        if (wrapped.empty()) {
            wrapped.push_back("No log yet");
        }

        const int log_offset = std::clamp(
            log_scroll_offset_,
            0,
            std::max(0, static_cast<int>(wrapped.size()) - static_cast<int>(kLogVisibleLines)));
        int y = kLogBodyY;
        for (const auto& line : SliceLines(wrapped, log_offset, kLogVisibleLines)) {
            texts.push_back({line, 12, y, 16});
            y += kLineHeight;
        }
    } else {
        // Settings page
        texts.push_back({"Settings", 12, kLogTitleY, 16});
        if (settings_editing_volume_) {
            texts.push_back({"UP/DN ±10 BOOT OK", 180, kLogTitleY, 14});
        }

        // Menu items
        const std::string vol_label = "Volume: " + std::to_string(volume_) + "%";
        const char* items[kSettingsItemCount] = {
            vol_label.c_str(),
            "Network Reset",
            "Restart",
            "Power Off"
        };

        int y = kLogBodyY;
        for (int i = 0; i < kSettingsItemCount; ++i) {
            std::string row = (i == settings_selected_item_) ? "> " : "  ";
            row += items[i];
            if (i == kSettingsItemVolume && settings_editing_volume_) {
                row += " *";
            }
            texts.push_back({row, 12, y, 16});
            y += kLineHeight * 2;  // extra spacing for readability
        }
    }

    texts.push_back({GetFooterText(), 12, kFooterTextY, 16});

    display_->DrawTexts(texts, true);
    DrawHorizontalLine(kStatusBarBottomY);
    DrawHorizontalLine(kHeaderLineY);
    if (active_page_ == Page::Summary) {
        DrawHorizontalLine(kPromptDividerY);
    }
    DrawHorizontalLine(kFooterTopY);
    DrawWifiIcon(10, 8);
    DrawBatteryIcon(382, 12, battery_known_ ? battery_level_ : 0, battery_charging_);
    display_->RequestUrgentRefresh();
}

void LanMicApp::Run() {
    if (!Initialize()) {
        ESP_LOGE(kTag, "Initialization failed");
        while (true) {
            vTaskDelay(pdMS_TO_TICKS(1000));
        }
    }

    bool last_pressed = false;
    int64_t last_reconnect_ms = 0;
    int64_t reconnect_interval_ms = kReconnectIntervalMinMs;
    int64_t last_battery_poll_ms = 0;
    // Tracks when the current "disconnected stretch" started.
    // Initialised to now so a cold boot with no server still gets a full grace
    // period before sleeping, but reset on every disconnect so a board that had
    // been happily connected for hours does not immediately deep-sleep after
    // the very first failed reconnect attempt.
    int64_t disconnected_since_ms = esp_timer_get_time() / 1000;

    while (true) {
        const int64_t now_ms = esp_timer_get_time() / 1000;
        if (connect_attempt_completed_.exchange(false, std::memory_order_acq_rel)) {
            if (IsServerConnected()) {
                reconnect_interval_ms = kReconnectIntervalMinMs;
                disconnected_since_ms = now_ms;
            } else if (server_uri_.empty() && cached_server_uri_.empty() && GetFallbackServerUri().empty()) {
                reconnect_interval_ms = kReconnectIntervalMinMs;
            } else {
                reconnect_interval_ms = std::min(reconnect_interval_ms * 2, kReconnectIntervalMaxMs);
            }
        }
        if (ws_disconnected_pending_.exchange(false)) {
            hello_sent_ = false;
            network_state_ = IsWifiConnected() ? NetworkState::Wifi : NetworkState::Offline;
            status_text_ = "Disconnected";
            hint_text_ = "Will retry automatically";
            phase_ = Phase::Idle;
            disconnected_since_ms = now_ms;
            reconnect_interval_ms = kReconnectIntervalMinMs;
            last_reconnect_ms = 0;
            UpdateDisplay();
        }
        if ((now_ms - last_battery_poll_ms) >= kBatteryPollIntervalMs) {
            last_battery_poll_ms = now_ms;
            RefreshBatteryStatus();
        }

        // Navigation buttons always work regardless of WiFi state
        if (up_long_pressed_.exchange(false)) {
            if (IsNavButtonPressed(TODO_DOWN_BUTTON_GPIO)) {
                EnterWifiSetupMode();
            } else {
                SwitchPage(Page::Summary);  // exits Settings too
            }
        }
        if (down_long_pressed_.exchange(false)) {
            if (IsNavButtonPressed(TODO_UP_BUTTON_GPIO)) {
                EnterWifiSetupMode();
            } else if (active_page_ == Page::Log) {
                EnterSettings();
            } else if (active_page_ == Page::Settings) {
                SwitchPage(Page::Summary);
            } else {
                SwitchPage(Page::Log);
            }
        }

        const bool up_click   = up_clicked_.exchange(false);
        const bool down_click = down_clicked_.exchange(false);

        if (active_page_ == Page::Settings) {
            const bool pressed_now = IsPttPressed();
            const bool boot_press  = pressed_now && !last_pressed;
            if (boot_press) last_pressed = true;
            if (!pressed_now) last_pressed = false;
            HandleSettingsInput(up_click, down_click, boot_press);
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        if (!IsWifiConnected()) {
            vTaskDelay(pdMS_TO_TICKS(200));
            continue;
        }

        if (!IsServerConnected() &&
            !connect_attempt_running_.load(std::memory_order_acquire) &&
            (now_ms - last_reconnect_ms) >= reconnect_interval_ms) {
            last_reconnect_ms = now_ms;
            StartConnectAttemptAsync();
        }

        // Time-based sleep: if no connection has been established within
        // kNoConnectionSleepMs, enter deep sleep to save battery.
        if (!IsServerConnected() &&
            !connect_attempt_running_.load(std::memory_order_acquire) &&
            (now_ms - disconnected_since_ms) >= kNoConnectionSleepMs) {
            DisconnectWebSocket();
            status_text_ = "No server";
            hint_text_ = "Press BOOT to retry";
            active_page_ = Page::Summary;
            UpdateDisplay();
            vTaskDelay(pdMS_TO_TICKS(800));
            esp_sleep_enable_ext0_wakeup(static_cast<gpio_num_t>(BOOT_BUTTON_GPIO), 0);
            esp_sleep_enable_timer_wakeup(5ULL * 60 * 1000 * 1000);  // 5 minutes
            esp_deep_sleep_start();
        }

        if (IsServerConnected()) {
            const int64_t last_pong_ms = ws_->GetLastPongMs();
            if (last_pong_ms > 0 && (now_ms - last_pong_ms) >= kPongTimeoutMs) {
                ESP_LOGW(kTag,
                         "WebSocket heartbeat timed out: last_pong_ms=%lld now_ms=%lld",
                         static_cast<long long>(last_pong_ms),
                         static_cast<long long>(now_ms));
                status_text_ = "Server timeout";
                hint_text_ = "Restarting...";
                UpdateDisplay();
                vTaskDelay(pdMS_TO_TICKS(50));
                esp_restart();
            }
        }

        if (up_click) {
            if (has_pending_transcript_) {
                if (IsServerConnected()) {
                    SendAction("action_send");
                } else {
                    disconnected_since_ms = now_ms;
                    reconnect_interval_ms = kReconnectIntervalMinMs;
                    last_reconnect_ms = now_ms;
                    StartConnectAttemptAsync();
                    status_text_ = "Connecting";
                    hint_text_ = "Retrying host...";
                    UpdateDisplay();
                }
            } else {
                HandleScroll(-1);
            }
        }
        if (down_click) {
            if (has_pending_transcript_) {
                if (IsServerConnected()) {
                    SendAction("action_undo");
                } else {
                    disconnected_since_ms = now_ms;
                    reconnect_interval_ms = kReconnectIntervalMinMs;
                    last_reconnect_ms = now_ms;
                    StartConnectAttemptAsync();
                    status_text_ = "Connecting";
                    hint_text_ = "Retrying host...";
                    UpdateDisplay();
                }
            } else {
                HandleScroll(1);
            }
        }

        const bool pressed = IsPttPressed();
        if (pressed && !last_pressed) {
            ESP_LOGI(kTag, "BOOT press connected=%d connect_task=%d phase=%d",
                     IsServerConnected() ? 1 : 0,
                     connect_attempt_running_.load(std::memory_order_acquire) ? 1 : 0,
                     static_cast<int>(phase_));
            if (!IsServerConnected()) {
                disconnected_since_ms = now_ms;
                reconnect_interval_ms = kReconnectIntervalMinMs;
                last_reconnect_ms = now_ms;
                StartConnectAttemptAsync();
                hint_text_ = "Retrying host...";
                status_text_ = "Connecting";
                phase_ = Phase::Idle;
                UpdateDisplay();
            } else {
                ESP_LOGI(kTag, "PTT start");
                SendPttStart();
                phase_ = Phase::Recording;
                status_text_ = "Recording";
                hint_text_ = "Release BOOT to send";
                // Flush a short rolling buffer first so speech around the
                // button edge is not clipped.
                FlushPrerollFrames();
                StreamAudioFrame();
                UpdateDisplay();
            }
            last_pressed = true;
        }

        if (!pressed && last_pressed) {
            ESP_LOGI(kTag, "BOOT release phase=%d", static_cast<int>(phase_));
            if (phase_ == Phase::Recording) {
                ESP_LOGI(kTag, "PTT stop");
                SendPttStop();
                phase_ = Phase::Transcribing;
                status_text_ = "Transcribing";
                UpdateDisplay();
            }
            last_pressed = false;
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }

        if (pressed) {
            if (phase_ == Phase::Recording) {
                StreamAudioFrame();
            } else {
                vTaskDelay(pdMS_TO_TICKS(10));
            }
            continue;
        }

        CapturePrerollFrame();
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}
