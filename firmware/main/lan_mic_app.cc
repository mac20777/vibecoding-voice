#include "lan_mic_app.h"

#include <cJSON.h>
#include <driver/gpio.h>
#include <esp_log.h>
#include <esp_random.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <lwip/inet.h>
#include <lwip/sockets.h>
#include <psa/crypto.h>

#include <algorithm>
#include <cmath>
#include <cerrno>
#include <cstring>
#include <cstdio>
#include <ctime>
#include <string>
#include <vector>

#include <esp_sleep.h>

#include "board.h"
#include "boards/zectrix-s3-epaper-4.2/config.h"
#include "components/78__xiaozhi-fonts/include/font_zectrix.h"  // Icon font definitions

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
constexpr char kBatteryStyleKey[] = "bat_style";  // 电池方向: 0=横向, 1=纵向
constexpr char kLastServerUriKey[] = "last_srv_uri";
constexpr char kPairedHostIdKey[] = "pair_host_id";
constexpr char kPairedHostNameKey[] = "pair_host_nm";
constexpr char kPendingTodoOpsKey[] = "todo_ops";
constexpr char kCachedTodoStateKey[] = "todo_cache";
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
constexpr int64_t kClientPingIntervalMs = 10000;
constexpr int64_t kPongTimeoutMs = 15000;
constexpr int64_t kServerSilenceTimeoutMs = 45000;
constexpr int64_t kConnectAttemptWatchdogMs = 20000;
constexpr int64_t kReconnectPromptTimeoutMs = 15000;
constexpr int64_t kTodoBootHoldMs = 600;
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
constexpr size_t kCachedTodoStateMaxBytes = 3500;
// WiFi 状态图标 (12x12) - 三种状态
// 已连接: 实心波形
constexpr uint8_t kWifiIconConnected12x12[] = {
    0x00, 0x00,  // row 0
    0x03, 0xC0,  // row 1: 顶部波形
    0x0F, 0xF0,  // row 2: 填充
    0x1F, 0xF8,  // row 3: 填充
    0x3F, 0xFC,  // row 4: 填充
    0x7F, 0xFE,  // row 5: 填充
    0x3F, 0xFC,  // row 6: 填充
    0x1F, 0xF8,  // row 7: 填充
    0x0F, 0xF0,  // row 8: 填充
    0x07, 0xE0,  // row 9: 底部实心点
    0x07, 0xE0,  // row 10: 实心点
    0x00, 0x00,  // row 11
};

// 未连接: 波形 + 叉号
constexpr uint8_t kWifiIconDisconnected12x12[] = {
    0x00, 0x00,  // row 0
    0x03, 0xC0,  // row 1: 顶部波形（空心）
    0x0C, 0x30,  // row 2: 空心
    0x10, 0x08,  // row 3: 空心
    0x03, 0xC0,  // row 4: 中间波形
    0x04, 0x20,  // row 5: 空心
    0x08, 0x10,  // row 6: 空心
    0x01, 0x80,  // row 7: 底部小点
    0x02, 0x40,  // row 8: 叉号左上
    0x04, 0x20,  // row 9: 叉号中心
    0x08, 0x10,  // row 10: 叉号右下
    0x00, 0x00,  // row 11
};

// 连接中: 波形 + 问号（用于闪烁显示）
constexpr uint8_t kWifiIconConnecting12x12[] = {
    0x00, 0x00,  // row 0
    0x03, 0xC0,  // row 1: 顶部波形
    0x0C, 0x30,  // row 2: 空心
    0x10, 0x08,  // row 3: 空心
    0x03, 0xC0,  // row 4: 中间波形
    0x0C, 0x30,  // row 5: 问号顶部圆弧
    0x04, 0x20,  // row 6: 问号竖线
    0x0C, 0x30,  // row 7: 问号底部
    0x00, 0x00,  // row 8: 空格
    0x08, 0x10,  // row 9: 问号点
    0x00, 0x00,  // row 10
    0x00, 0x00,  // row 11
};

// 竖向电池图标 (10x18) - 轮廓 + 动态填充
// 设计: 顶部有充电指示头，主体为竖向柱状条
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

// 计算文字的显示宽度（16px 字体）
// ASCII 字符约 8px，中文字符约 16px
int CalculateTextWidth(const std::string& text) {
    int width = 0;
    for (size_t i = 0; i < text.size();) {
        const unsigned char ch = static_cast<unsigned char>(text[i]);
        size_t char_len = 1;
        if ((ch & 0x80) == 0x00) {
            char_len = 1;
            width += 8;  // ASCII: 8px
        } else if ((ch & 0xE0) == 0xC0) {
            char_len = 2;
            width += 8;  // 2字节 UTF-8: 通常是拉丁扩展字符
        } else if ((ch & 0xF0) == 0xE0) {
            char_len = 3;
            width += 16; // 中文等宽字符: 16px
        } else if ((ch & 0xF8) == 0xF0) {
            char_len = 4;
            width += 16; // 4字节字符
        }
        i += char_len;
    }
    return width;
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

    // 初始化 LVGL UI 管理器（如果 display 支持 LVGL）
    if (display_ != nullptr) {
        lv_display_t* lv_display = display_->GetLvDisplay();
        if (lv_display != nullptr) {
    ui_manager_ = std::make_unique<ui::UiManager>();
            ui_manager_->Init(lv_display);
            ESP_LOGI(kTag, "LVGL UI Manager initialized");
        }
    }

    ConfigureButtons();
    // The e-paper status bar already shows device state; keep the board LED
    // off so power/app LED blinking does not look like an error or recording.
    ZectrixSetFactoryLedOverride(true, false);

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
    active_page_ = Page::Summary;  // Default to AI chat page (大模型对话)
    voice_mode_ = VoiceMode::Normal;  // Live mode for AI chat
    hint_text_ = "Hold BOOT to talk\nUP/DN for pages";
    phase_ = Phase::Idle;
    network_state_ = NetworkState::Offline;
    RefreshBatteryStatus(true);
    UpdateDisplay();
    // Force a full e-paper refresh on startup to clear any residual image
    // from a previous firmware (e.g. factory test page)
    if (display_ != nullptr) {
        display_->RequestUrgentFullRefresh();
    }

    // Only clear WiFi config on true first boot.
    // Accessing SsidManager triggers LoadFromNvs(), so we can check for saved credentials.
    // This prevents wiping user-configured WiFi if the device reboots before server pairing.
    bool has_saved_creds = !SsidManager::GetInstance().GetSsidList().empty();
    if (first_boot_ && !has_saved_creds) {
        ESP_LOGW(kTag, "First boot: clearing WiFi config for initial setup");
        SsidManager::GetInstance().Clear();
    } else if (first_boot_ && has_saved_creds) {
        ESP_LOGI(kTag, "First boot detected but WiFi credentials exist, skipping clear");
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
                if (active_page_ == Page::Todo) {
                    offline_todo_mode_ = true;
                    todo_last_action_text_ = "Offline Todo";
                } else {
                    active_page_ = Page::Summary;
                }
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
                ESP_LOGI(kTag, "WiFi config mode exited");
                network_state_ = NetworkState::Offline;
                RequestWifiReconfigureByReboot("Restarting...", "Applying Wi-Fi setup");
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
    battery_vertical_ = nvs.GetInt(kBatteryStyleKey, 0) != 0;  // 默认横向
    cached_server_uri_ = nvs.GetString(kLastServerUriKey, "");
    paired_host_id_ = nvs.GetString(kPairedHostIdKey, "");
    paired_host_name_ = nvs.GetString(kPairedHostNameKey, "");

    // Detect first boot: no paired host and no cached server URI
    first_boot_ = paired_host_id_.empty() && cached_server_uri_.empty();
    if (first_boot_) {
        ESP_LOGI(kTag, "First boot detected (no persisted state)");
    }

    if (!paired_host_id_.empty()) {
        ESP_LOGI(kTag, "Loaded paired host: id=%s name=%s",
                 paired_host_id_.c_str(),
                 paired_host_name_.empty() ? "(unknown)" : paired_host_name_.c_str());
    }
    if (!cached_server_uri_.empty()) {
        ESP_LOGI(kTag, "Loaded cached server URI: %s", cached_server_uri_.c_str());
    }
    LoadCachedTodoState();
    LoadPendingTodoOps();
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

void LanMicApp::RequestWifiReconfigureByReboot(const char* status_text, const char* hint_text) {
    bool expected = false;
    if (!wifi_reconfigure_restart_pending_.compare_exchange_strong(expected,
                                                                   true,
                                                                   std::memory_order_acq_rel,
                                                                   std::memory_order_acquire)) {
        return;
    }

    ESP_LOGI(kTag, "Request reconfigure WiFi by reboot");
    connect_cancel_requested_.store(true, std::memory_order_release);
    ws_disconnected_pending_.store(false, std::memory_order_release);
    hello_sent_ = false;

    status_text_ = status_text != nullptr ? status_text : "Restarting...";
    hint_text_ = hint_text != nullptr ? hint_text : "Reconfiguring Wi-Fi";
    active_page_ = Page::Summary;
    summary_scroll_offset_ = 0;
    UpdateDisplay();

    if (xTaskCreate([](void* arg) {
            auto* self = static_cast<LanMicApp*>(arg);
            vTaskDelay(pdMS_TO_TICKS(600));
            esp_restart();
            self->wifi_reconfigure_restart_pending_.store(false, std::memory_order_release);
            vTaskDelete(nullptr);
        },
        "wifi_reboot",
        3072,
        this,
        5,
        nullptr) != pdPASS) {
        wifi_reconfigure_restart_pending_.store(false, std::memory_order_release);
        vTaskDelay(pdMS_TO_TICKS(200));
        esp_restart();
    }
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
    up_button_.OnDoubleClick([this]() {
        ESP_LOGI(kTag, "UP double click");
        up_double_clicked_.store(true);
    });
    down_button_.OnDoubleClick([this]() {
        ESP_LOGI(kTag, "DOWN double click");
        down_double_clicked_.store(true);
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
    connect_attempt_started_ms_.store(esp_timer_get_time() / 1000, std::memory_order_release);
    reconnect_stuck_prompt_ = false;

    if (xTaskCreate([](void* arg) {
            auto* self = static_cast<LanMicApp*>(arg);
            self->RunConnectAttemptTask();
            self->connect_task_handle_ = nullptr;
            self->connect_attempt_started_ms_.store(0, std::memory_order_release);
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
        connect_attempt_started_ms_.store(0, std::memory_order_release);
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
#if CONFIG_LAN_DISCOVERY_ENABLED
    if (!server_uri_.empty()) {
        target_uri = server_uri_.c_str();
        target_source = "discovery";
    } else {
        DiscoverServerUri();
        if (!server_uri_.empty()) {
            target_uri = server_uri_.c_str();
            target_source = "discovery";
        } else if (!cached_server_uri_.empty()) {
            target_uri = cached_server_uri_.c_str();
            target_source = "cache";
        }
    }
#else
    if (!server_uri_.empty()) {
        target_uri = server_uri_.c_str();
        target_source = "configured";
    } else if (!cached_server_uri_.empty()) {
        target_uri = cached_server_uri_.c_str();
        target_source = "cache";
    }
#endif

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
        board_.SetPowerSaveLevel(PowerSaveLevel::BALANCED);
        SaveCachedServerUri(target_uri_text);
        network_state_ = NetworkState::Server;
        status_text_ = "Connected";
        hint_text_ = "";  // BuildPromptBody() will show "Hold BOOT to talk"
        phase_ = Phase::Idle;
        ShowIdleTodoPage();
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
        active_page_ = Page::Summary;
        UpdateDisplay();
    });
    ws_->OnData([this](const char* data, size_t len, bool binary) {
        if (!binary && data != nullptr && len > 0) {
            HandleServerMessage(data, len);
        } else if (binary && data != nullptr && len > 0) {
            HandleTtsAudio(data, len);
        }
    });

    if (!ws_->Connect(target_uri)) {
        ESP_LOGW(kTag, "WebSocket connect failed: %s", target_uri);
        ws_.reset();
        hello_sent_ = false;
        if (std::strcmp(target_source, "discovery") == 0) {
            ESP_LOGW(kTag, "Discovered URI failed, forcing discovery next round");
            server_uri_.clear();
        } else if (std::strcmp(target_source, "cache") == 0) {
            ESP_LOGW(kTag, "Cache connect failed; will retry discovery before reusing cache");
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

    psa_status_t status = psa_crypto_init();
    if (status != PSA_SUCCESS) {
        ESP_LOGW(kTag, "PSA crypto init failed: %d", status);
        return "";
    }

    psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&attributes, PSA_KEY_TYPE_HMAC);
    psa_set_key_algorithm(&attributes, PSA_ALG_HMAC(PSA_ALG_SHA_256));
    psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_SIGN_HASH);

    psa_key_id_t key = 0;
    status = psa_import_key(&attributes,
        reinterpret_cast<const uint8_t*>(CONFIG_LAN_SHARED_SECRET),
        std::strlen(CONFIG_LAN_SHARED_SECRET), &key);
    psa_reset_key_attributes(&attributes);
    if (status != PSA_SUCCESS) {
        ESP_LOGW(kTag, "PSA key import failed: %d", status);
        return "";
    }

    unsigned char digest[32] = {0};
    size_t digest_len = 0;
    status = psa_mac_compute(key, PSA_ALG_HMAC(PSA_ALG_SHA_256),
        reinterpret_cast<const uint8_t*>(payload.data()), payload.size(),
        digest, sizeof(digest), &digest_len);
    psa_destroy_key(key);
    if (status != PSA_SUCCESS) {
        ESP_LOGW(kTag, "PSA MAC compute failed: %d", status);
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
    ESP_LOGW(kTag, "Clearing saved Wi-Fi and scheduling reboot into config mode");
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
    RequestWifiReconfigureByReboot("Restarting...", "Rebooting into Wi-Fi setup");
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

bool LanMicApp::SendSetMode(const char* mode) {
    char message[128];
    snprintf(message,
             sizeof(message),
             "{\"type\":\"set_mode\",\"mode\":\"%s\"}",
             mode);
    return SendJson(message);
}

bool LanMicApp::SendTodoCommand(const char* action, int index, int completed, const char* id) {
    char message[384];
    char id_part[96] = "";
    if (id != nullptr && id[0] != '\0') {
        snprintf(id_part, sizeof(id_part), ",\"id\":\"%s\"", id);
    }
    if (index > 0 && completed >= 0) {
        snprintf(message,
                 sizeof(message),
                 "{\"type\":\"todo_command\",\"action\":\"%s\",\"index\":%d,\"completed\":%s%s}",
                 action,
                 index,
                 completed ? "true" : "false",
                 id_part);
    } else if (index > 0) {
        snprintf(message,
                 sizeof(message),
                 "{\"type\":\"todo_command\",\"action\":\"%s\",\"index\":%d%s}",
                 action,
                 index,
                 id_part);
    } else if (completed >= 0) {
        snprintf(message,
                 sizeof(message),
                 "{\"type\":\"todo_command\",\"action\":\"%s\",\"completed\":%s%s}",
                 action,
                 completed ? "true" : "false",
                 id_part);
    } else {
        snprintf(message,
                 sizeof(message),
                 "{\"type\":\"todo_command\",\"action\":\"%s\"%s}",
                 action,
                 id_part);
    }
    return SendJson(message);
}

LanMicApp::VoiceMode LanMicApp::DesiredVoiceModeForPage(Page page) const {
    return page == Page::Todo ? VoiceMode::Todo : VoiceMode::Normal;
}

bool LanMicApp::SyncVoiceModeToPage(Page page) {
    const VoiceMode desired = DesiredVoiceModeForPage(page);
    if (!IsServerConnected()) {
        voice_mode_ = desired;
        return false;
    }
    if (voice_mode_ == desired) {
        return true;
    }
    if (!SendSetMode(desired == VoiceMode::Todo ? "todo" : "normal")) {
        return false;
    }
    voice_mode_ = desired;
    return true;
}

bool LanMicApp::SyncVoiceModeToActivePage() {
    return SyncVoiceModeToPage(active_page_);
}

LanMicApp::Page LanMicApp::PageForCurrentVoiceMode() const {
    return voice_mode_ == VoiceMode::Todo ? Page::Todo : Page::Summary;
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
        offline_todo_mode_ = false;
        reconnect_stuck_prompt_ = false;
        todo_menu_open_ = false;
        if (!has_pending_transcript_) {
            phase_ = Phase::Idle;
        }
        // 连上服务器：禁用提示音防止 crash
        // PlayBeep(600, 80);
        // PlayBeep(900, 100);
        ESP_LOGI(kTag, "Server connected (Beep disabled)");
    } else if (strcmp(type, "server_ready") == 0) {
        status_text_ = "Ready";
        offline_todo_mode_ = false;
        reconnect_stuck_prompt_ = false;
        todo_menu_open_ = false;
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
        const char* mode = GetJsonString(root, "mode");
        if (mode != nullptr) {
            voice_mode_ = strcmp(mode, "todo") == 0 ? VoiceMode::Todo : VoiceMode::Normal;
        }
        if (pending_normal_after_reconnect_) {
            pending_normal_after_reconnect_ = false;
            active_page_ = Page::Summary;
        }
        SyncVoiceModeToActivePage();
    } else if (strcmp(type, "mode_state") == 0) {
        const char* mode = GetJsonString(root, "mode");
        if (mode != nullptr) {
            voice_mode_ = strcmp(mode, "todo") == 0 ? VoiceMode::Todo : VoiceMode::Normal;
            if (phase_ == Phase::Idle && !has_pending_transcript_) {
                SyncVoiceModeToActivePage();
            }
        }
    } else if (strcmp(type, "todo_state") == 0) {
        cJSON* items = cJSON_GetObjectItemCaseSensitive(root, "items");
        cJSON* selected_index = cJSON_GetObjectItemCaseSensitive(root, "selectedIndex");
        const char* last_action = GetJsonString(root, "lastActionText");
        todo_items_.clear();
        if (cJSON_IsArray(items)) {
            cJSON* item = nullptr;
            cJSON_ArrayForEach(item, items) {
                const char* id = GetJsonString(item, "id");
                const char* title = GetJsonString(item, "title");
                if (title == nullptr) {
                    continue;
                }
                todo_items_.push_back({
                    id != nullptr ? id : "",
                    title,
                    GetJsonBool(item, "completed", false)
                });
            }
        }
        if (cJSON_IsNumber(selected_index)) {
            todo_selected_index_ = selected_index->valueint;
        } else {
            todo_selected_index_ = todo_items_.empty() ? -1 : 0;
        }
        if (todo_items_.empty()) {
            todo_selected_index_ = -1;
        } else {
            todo_selected_index_ = std::clamp(
                todo_selected_index_,
                0,
                static_cast<int>(todo_items_.size()) - 1);
        }
        if (last_action != nullptr) {
            todo_last_action_text_ = last_action;
        }
        SaveCachedTodoState();
        offline_todo_mode_ = false;
        reconnect_stuck_prompt_ = false;
        FlushPendingTodoOps();
    } else if (strcmp(type, "todo_result") == 0) {
        const char* message = GetJsonString(root, "message");
        const bool ok = GetJsonBool(root, "ok", false);
        phase_ = Phase::Idle;
        status_text_ = ok ? "Todo" : "Todo err";
        hint_text_ = message != nullptr ? message : "";
        if (message != nullptr) {
            todo_last_action_text_ = message;
        }
        active_page_ = Page::Todo;
    } else if (strcmp(type, "status") == 0) {
        const char* status = GetJsonString(root, "status");
        const char* text_value = GetJsonString(root, "text");
        if (status != nullptr) {
            if (strcmp(status, "recording") == 0) {
                phase_ = Phase::Recording;
                status_text_ = "Recording";
                active_page_ = PageForCurrentVoiceMode();
            } else if (strcmp(status, "transcribing") == 0) {
                phase_ = Phase::Transcribing;
                status_text_ = "Transcribing";
                active_page_ = PageForCurrentVoiceMode();
                PlayBeep(660, 80);   // 停止录音/转录中：短低音
            } else if (strcmp(status, "awaiting_action") == 0) {
                phase_ = Phase::AwaitingAction;
                status_text_ = "Ready to send";
                has_pending_transcript_ = true;
                active_page_ = Page::Summary;
                // 不重置滚动位置，保持显示最新消息
            } else if (strcmp(status, "typed") == 0) {
                const bool text_injector = send_target_ == "text_injector";
                phase_ = text_injector ? Phase::Idle : Phase::Running;
                status_text_ = text_injector ? "Injected" : "Sent";
                has_pending_transcript_ = false;
                active_page_ = Page::Summary;
            } else if (strcmp(status, "undo_ok") == 0) {
                phase_ = Phase::Idle;
                status_text_ = "Canceled";
                has_pending_transcript_ = false;
                ShowIdleTodoPage();
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
                    ShowIdleTodoPage();
                }
            } else if (strcmp(status, "no_pending") == 0) {
                phase_ = Phase::Idle;
                status_text_ = "Nothing pending";
                ShowIdleTodoPage();
            } else if (strcmp(status, "cli_busy") == 0) {
                phase_ = Phase::Running;
                status_text_ = std::string(GetToolLabel()) + " busy";
                active_page_ = Page::Summary;
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
            // Add user message to chat history when transcript is finalized
            if (strlen(text_value) > 0) {
                // Check for duplicate
                if (chat_history_.empty() ||
                    chat_history_.back().role != ChatRole::User ||
                    chat_history_.back().text != text_value) {
                    chat_history_.push_back({ChatRole::User, text_value});
                    // Trim history if exceeds max size
                    while (chat_history_.size() > kMaxChatHistorySize) {
                        chat_history_.erase(chat_history_.begin());
                    }
                    // Auto-scroll to show the new message
                    summary_scroll_offset_ = INT_MAX;  // Will be clamped in UpdateDisplay
                }
            }
        }
        has_pending_transcript_ = GetJsonBool(root, "requiresAction", false);
        phase_ = has_pending_transcript_ ? Phase::AwaitingAction : Phase::Idle;
        if (has_pending_transcript_) {
            status_text_ = "Ready to send";
        } else {
            status_text_ = voice_mode_ == VoiceMode::Todo ? "Todo input" : "Transcript ready";
        }
        active_page_ = PageForCurrentVoiceMode();
    } else if (strcmp(type, "transcript_cleared") == 0) {
        transcript_text_.clear();
        has_pending_transcript_ = false;
        phase_ = Phase::Idle;
        status_text_ = "Cleared";
        ShowIdleTodoPage();
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
                active_page_ = Page::Summary;
            } else if (strcmp(phase, "error") == 0) {
                phase_ = Phase::Error;
                active_page_ = Page::Summary;
                PlayBeep(300, 300);  // 出错：低沉长音
            } else if (!has_pending_transcript_) {
                phase_ = Phase::Idle;
                ShowIdleTodoPage();
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
        const bool done = GetJsonBool(root, "done", false);
        if (latest_user != nullptr) {
            transcript_text_ = latest_user;
        }
        if (latest_assistant != nullptr) {
            latest_assistant_text_ = latest_assistant;
        }
        // Update chat history when conversation completes
        if (done && latest_user != nullptr && strlen(latest_user) > 0) {
            // Add user message if not duplicate
            if (chat_history_.empty() ||
                chat_history_.back().role != ChatRole::User ||
                chat_history_.back().text != latest_user) {
                chat_history_.push_back({ChatRole::User, latest_user});
            }
        }
        if (done && latest_assistant != nullptr && strlen(latest_assistant) > 0) {
            // Add assistant message if not duplicate
            if (chat_history_.empty() ||
                chat_history_.back().role != ChatRole::Assistant ||
                chat_history_.back().text != latest_assistant) {
                chat_history_.push_back({ChatRole::Assistant, latest_assistant});
                // Auto-scroll to show new AI response
                summary_scroll_offset_ = INT_MAX;  // Will be clamped in UpdateDisplay
            }
            // Trim history if exceeds max size
            while (chat_history_.size() > kMaxChatHistorySize) {
                chat_history_.erase(chat_history_.begin());
            }

            // 防呆处理：尝试从 AI 回复中提取倒计时 JSON
            // LLM 可能返回 ```json {"type":"timer"...} ``` 格式
            TryExtractTimerJson(latest_assistant);
        }
        if (status_line != nullptr) {
            cli_status_text_ = status_line;
        }
        if (repo_name != nullptr) {
            repo_name_ = repo_name;
        }
        if (phase_ == Phase::Running) {
            active_page_ = Page::Summary;
        }
        // If LLM is done, reset phase to Idle so UI shows completed state
        // Do NOT call ShowIdleTodoPage() to preserve conversation display
        if (done && phase_ == Phase::Running) {
            phase_ = Phase::Idle;
            cli_phase_text_ = "idle";
            PlayBeep(800, 80);
            PlayBeep(1000, 100);  // AI reply complete: rising double beep
        }
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
    } else if (strcmp(type, "timer") == 0) {
        // 智能倒计时：解析 {"type": "timer", "duration": 300, "label": "泡面"}
        cJSON* duration_json = cJSON_GetObjectItemCaseSensitive(root, "duration");
        const char* label = GetJsonString(root, "label");

        if (cJSON_IsNumber(duration_json) && duration_json->valueint > 0) {
            countdown_state_.duration_seconds = duration_json->valueint;
            countdown_state_.remaining_seconds = duration_json->valueint;
            countdown_state_.label = label != nullptr ? label : "";
            countdown_state_.active = true;
            countdown_state_.alarming = false;
            countdown_state_.alarm_count = 0;
            countdown_state_.started_at_ms = esp_timer_get_time() / 1000;
            countdown_state_.last_alarm_at_ms = 0;

            // 切换到倒计时页面
            active_page_ = Page::Countdown;
            phase_ = Phase::Idle;
            status_text_ = "倒计时";
            hint_text_ = "按任意键停止";

            ESP_LOGI(kTag, "Timer started: %d seconds, label: %s",
                     countdown_state_.duration_seconds, countdown_state_.label.c_str());

            // 开始倒计时提示音
            PlayBeep(880, 100);
            PlayBeep(1100, 150);
        }
    } else if (strcmp(type, "weather_data") == 0) {
        // 天气数据：从后端接收 QWeather API 数据
        const char* city = GetJsonString(root, "city");
        cJSON* temp_json = cJSON_GetObjectItemCaseSensitive(root, "temp");
        const char* desc = GetJsonString(root, "desc");
        cJSON* low_json = cJSON_GetObjectItemCaseSensitive(root, "low");
        cJSON* high_json = cJSON_GetObjectItemCaseSensitive(root, "high");
        cJSON* humidity_json = cJSON_GetObjectItemCaseSensitive(root, "humidity");
        const char* wind_dir = GetJsonString(root, "windDir");
        cJSON* wind_level_json = cJSON_GetObjectItemCaseSensitive(root, "windLevel");
        const char* sunrise = GetJsonString(root, "sunrise");
        const char* sunset = GetJsonString(root, "sunset");
        const char* advice = GetJsonString(root, "advice");

        if (city != nullptr) {
            weather_state_.city = city;
        }
        if (cJSON_IsNumber(temp_json)) {
            weather_state_.today_temp = temp_json->valueint;
        }
        if (desc != nullptr) {
            weather_state_.today_desc = desc;
        }
        if (cJSON_IsNumber(low_json)) {
            weather_state_.today_low = low_json->valueint;
        }
        if (cJSON_IsNumber(high_json)) {
            weather_state_.today_high = high_json->valueint;
        }
        if (cJSON_IsNumber(humidity_json)) {
            weather_state_.today_humidity = humidity_json->valueint;
        }
        if (wind_dir != nullptr) {
            weather_state_.today_wind_dir = wind_dir;
        }
        if (cJSON_IsNumber(wind_level_json)) {
            weather_state_.today_wind_level = wind_level_json->valueint;
        }
        if (sunrise != nullptr) {
            weather_state_.sunrise = sunrise;
        }
        if (sunset != nullptr) {
            weather_state_.sunset = sunset;
        }
        if (advice != nullptr) {
            weather_state_.advice = advice;
        }

        // 解析预报数据
        cJSON* forecast = cJSON_GetObjectItemCaseSensitive(root, "forecast");
        if (cJSON_IsArray(forecast)) {
            weather_state_.forecast.clear();
            cJSON* day = nullptr;
            cJSON_ArrayForEach(day, forecast) {
                const char* weekday = GetJsonString(day, "weekday");
                const char* fdesc = GetJsonString(day, "desc");
                cJSON* ftemp_json = cJSON_GetObjectItemCaseSensitive(day, "temp");
                if (weekday != nullptr && fdesc != nullptr) {
                    WeatherState::ForecastDay fd;
                    fd.weekday = weekday;
                    fd.desc = fdesc;
                    fd.temp = cJSON_IsNumber(ftemp_json) ? ftemp_json->valueint : 0;
                    weather_state_.forecast.push_back(fd);
                }
            }
        }

        weather_state_.has_data = true;
        ESP_LOGI(kTag, "Weather data received: %s %d°C", weather_state_.city.c_str(), weather_state_.today_temp);
    }

    cJSON_Delete(root);
    UpdateDisplay();
}

void LanMicApp::HandleTtsAudio(const char* data, size_t len) {
    if (len < 3) {
        ESP_LOGW(kTag, "TTS audio packet too small: %zu bytes", len);
        return;
    }

    // Binary format: 2 bytes header length (BE), JSON header, PCM16 audio data
    const uint16_t header_len = (static_cast<uint16_t>(data[0]) << 8) | static_cast<uint16_t>(data[1]);
    if (len < static_cast<size_t>(2 + header_len)) {
        ESP_LOGW(kTag, "TTS audio packet header truncated: %zu < %u", len, 2 + header_len);
        return;
    }

    // Parse JSON header
    cJSON* root = cJSON_ParseWithLength(data + 2, header_len);
    if (root == nullptr) {
        ESP_LOGW(kTag, "Failed to parse TTS audio header JSON");
        return;
    }

    const char* type = GetJsonString(root, "type");
    if (type == nullptr || strcmp(type, "tts_audio") != 0) {
        ESP_LOGW(kTag, "Unexpected TTS message type: %s", type ? type : "null");
        cJSON_Delete(root);
        return;
    }

    const char* format = GetJsonString(root, "format");
    cJSON* sample_rate_json = cJSON_GetObjectItemCaseSensitive(root, "sampleRate");

    if (format == nullptr || strcmp(format, "pcm16") != 0) {
        ESP_LOGW(kTag, "Unsupported TTS format: %s", format ? format : "null");
        cJSON_Delete(root);
        return;
    }

    const int sample_rate = cJSON_IsNumber(sample_rate_json) ? sample_rate_json->valueint : 16000;
    cJSON_Delete(root);

    // Extract PCM16 audio data
    const size_t audio_offset = 2 + header_len;
    const size_t audio_len = len - audio_offset;
    if (audio_len < 2) {
        ESP_LOGW(kTag, "TTS audio data empty");
        return;
    }

    // Audio should be 16kHz mono PCM16 (signed 16-bit LE)
    if (sample_rate != 16000) {
        ESP_LOGW(kTag, "TTS sample rate %d not supported (expected 16000)", sample_rate);
        return;
    }

    const int16_t* pcm_data = reinterpret_cast<const int16_t*>(data + audio_offset);
    const size_t samples = audio_len / sizeof(int16_t);

    ESP_LOGI(kTag, "TTS audio received: %zu samples (%zu bytes)", samples, audio_len);

    // Play the audio
    PlayTtsAudio(pcm_data, samples);
}

void LanMicApp::PlayTtsAudio(const int16_t* pcm_data, size_t samples) {
    if (codec_ == nullptr || pcm_data == nullptr || samples == 0) {
        return;
    }

    // Enable audio output
    codec_->EnableOutput(true);
    codec_->SetOutputVolume(volume_);

    ESP_LOGI(kTag, "Playing TTS audio: %zu samples at volume %d", samples, volume_);

    // Use codec's OutputData method to play audio
    // Process in chunks to avoid large memory allocations
    // Chunk size: 512 samples = 32ms at 16kHz
    constexpr size_t kChunkSize = 512;
    constexpr int kChunkDurationMs = 32;  // 512 samples / 16000 Hz * 1000 = 32ms
    size_t offset = 0;

    while (offset < samples) {
        const size_t chunk_samples = std::min(kChunkSize, samples - offset);
        std::vector<int16_t> chunk_data(pcm_data + offset, pcm_data + offset + chunk_samples);
        codec_->OutputData(chunk_data);
        offset += chunk_samples;
        // Delay should be slightly longer than chunk duration to allow DMA to complete
        // Note: FreeRTOS tick rate is typically 100Hz (10ms precision)
        // pdMS_TO_TICKS(37) rounds to 4 ticks = 40ms due to tick alignment
        vTaskDelay(pdMS_TO_TICKS(kChunkDurationMs + 5));
    }

    // Wait for final playback to complete
    vTaskDelay(pdMS_TO_TICKS(50));

    ESP_LOGI(kTag, "TTS playback complete");
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

void LanMicApp::MoveTodoSelection(int direction) {
    if (direction == 0 || todo_items_.empty()) {
        return;
    }

    const int count = static_cast<int>(todo_items_.size());
    const int current = todo_selected_index_ < 0 ? 0 : std::clamp(todo_selected_index_, 0, count - 1);
    const int next = todo_selected_index_ < 0
        ? 0
        : (current + direction + count) % count;
    if (next == todo_selected_index_) {
        return;
    }

    todo_selected_index_ = next;
    todo_last_action_text_ = "当前计划 " + std::to_string(todo_selected_index_ + 1);
    if (IsServerConnected()) {
        SendTodoCommand(direction < 0 ? "select_prev" : "select_next");
    }
    UpdateDisplay();
}

void LanMicApp::ToggleSelectedTodo() {
    if (todo_items_.empty() ||
        todo_selected_index_ < 0 ||
        todo_selected_index_ >= static_cast<int>(todo_items_.size())) {
        status_text_ = "No todo";
        hint_text_ = "Add a plan first";
        UpdateDisplay();
        return;
    }

    const int item_index = todo_selected_index_ + 1;
    const bool next_completed = !todo_items_[todo_selected_index_].completed;
    const TodoItem item = todo_items_[todo_selected_index_];
    todo_items_[todo_selected_index_].completed = next_completed;
    todo_last_action_text_ = next_completed
        ? "已完成计划 " + std::to_string(item_index)
        : "已恢复计划 " + std::to_string(item_index);

    if (IsServerConnected()) {
        SendTodoCommand("toggle", item_index, next_completed ? 1 : 0, item.id.c_str());
    } else {
        QueueOfflineTodoToggle(item, next_completed);
        todo_last_action_text_ += " (待同步)";
    }
    SaveCachedTodoState();
    UpdateDisplay();
}

void LanMicApp::DeleteSelectedTodo() {
    if (todo_items_.empty() ||
        todo_selected_index_ < 0 ||
        todo_selected_index_ >= static_cast<int>(todo_items_.size())) {
        status_text_ = "No todo";
        hint_text_ = "Add a plan first";
        UpdateDisplay();
        return;
    }

    const int item_index = todo_selected_index_ + 1;
    const TodoItem item = todo_items_[todo_selected_index_];
    todo_items_.erase(todo_items_.begin() + todo_selected_index_);
    if (todo_items_.empty()) {
        todo_selected_index_ = -1;
    } else {
        todo_selected_index_ = std::min(
            todo_selected_index_,
            static_cast<int>(todo_items_.size()) - 1);
    }

    todo_last_action_text_ = "已删除计划 " + std::to_string(item_index);
    if (IsServerConnected()) {
        SendTodoCommand("delete", item_index, -1, item.id.c_str());
    } else {
        QueueOfflineTodoDelete(item);
        todo_last_action_text_ += " (待同步)";
    }
    SaveCachedTodoState();
    UpdateDisplay();
}

void LanMicApp::QueueOfflineTodoToggle(const TodoItem& item, bool completed) {
    if (item.id.empty()) {
        return;
    }
    for (const auto& op : pending_todo_ops_) {
        if (op.id == item.id && op.type == PendingTodoOpType::Delete) {
            return;
        }
    }
    pending_todo_ops_.erase(
        std::remove_if(
            pending_todo_ops_.begin(),
            pending_todo_ops_.end(),
            [&item](const PendingTodoOp& op) {
                return op.id == item.id && op.type == PendingTodoOpType::Toggle;
            }),
        pending_todo_ops_.end());
    pending_todo_ops_.push_back({PendingTodoOpType::Toggle, item.id, completed});
    SavePendingTodoOps();
}

void LanMicApp::QueueOfflineTodoDelete(const TodoItem& item) {
    if (item.id.empty()) {
        return;
    }
    pending_todo_ops_.erase(
        std::remove_if(
            pending_todo_ops_.begin(),
            pending_todo_ops_.end(),
            [&item](const PendingTodoOp& op) {
                return op.id == item.id;
            }),
        pending_todo_ops_.end());
    pending_todo_ops_.push_back({PendingTodoOpType::Delete, item.id, false});
    SavePendingTodoOps();
}

void LanMicApp::FlushPendingTodoOps() {
    if (!IsServerConnected() || pending_todo_ops_.empty()) {
        return;
    }

    size_t sent = 0;
    for (const auto& op : pending_todo_ops_) {
        const bool ok = op.type == PendingTodoOpType::Toggle
            ? SendTodoCommand("toggle", 0, op.completed ? 1 : 0, op.id.c_str())
            : SendTodoCommand("delete", 0, -1, op.id.c_str());
        if (!ok) {
            break;
        }
        ++sent;
    }

    if (sent > 0) {
        pending_todo_ops_.erase(pending_todo_ops_.begin(), pending_todo_ops_.begin() + sent);
        SavePendingTodoOps();
        todo_last_action_text_ = pending_todo_ops_.empty()
            ? "离线更改已同步"
            : "部分离线更改待同步";
    }
}

void LanMicApp::LoadCachedTodoState() {
    Settings nvs(kLanMicNamespace);
    const std::string serialized = nvs.GetString(kCachedTodoStateKey, "");
    if (serialized.empty()) {
        return;
    }

    cJSON* root = cJSON_Parse(serialized.c_str());
    if (!cJSON_IsObject(root)) {
        if (root != nullptr) {
            cJSON_Delete(root);
        }
        ESP_LOGW(kTag, "Ignoring corrupt cached todo state");
        Settings writable(kLanMicNamespace, true);
        writable.EraseKey(kCachedTodoStateKey);
        return;
    }

    cJSON* items = cJSON_GetObjectItemCaseSensitive(root, "items");
    cJSON* selected_index = cJSON_GetObjectItemCaseSensitive(root, "selectedIndex");
    const char* last_action = GetJsonString(root, "lastActionText");

    std::vector<TodoItem> cached_items;
    if (cJSON_IsArray(items)) {
        cJSON* item = nullptr;
        cJSON_ArrayForEach(item, items) {
            const char* id = GetJsonString(item, "id");
            const char* title = GetJsonString(item, "title");
            if (title == nullptr || title[0] == '\0') {
                continue;
            }
            cached_items.push_back({
                id != nullptr ? id : "",
                title,
                GetJsonBool(item, "completed", false)
            });
        }
    }

    todo_items_ = std::move(cached_items);
    if (cJSON_IsNumber(selected_index)) {
        todo_selected_index_ = selected_index->valueint;
    } else {
        todo_selected_index_ = todo_items_.empty() ? -1 : 0;
    }
    if (todo_items_.empty()) {
        todo_selected_index_ = -1;
    } else {
        todo_selected_index_ = std::clamp(
            todo_selected_index_,
            0,
            static_cast<int>(todo_items_.size()) - 1);
    }
    if (last_action != nullptr && last_action[0] != '\0') {
        todo_last_action_text_ = last_action;
    } else if (!todo_items_.empty()) {
        todo_last_action_text_ = "Cached Todo";
    }

    ESP_LOGI(kTag, "Loaded %u cached todo items",
             static_cast<unsigned>(todo_items_.size()));
    cJSON_Delete(root);
}

void LanMicApp::SaveCachedTodoState() {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "selectedIndex", todo_selected_index_);
    if (!todo_last_action_text_.empty()) {
        cJSON_AddStringToObject(root, "lastActionText", todo_last_action_text_.c_str());
    }

    cJSON* items = cJSON_CreateArray();
    for (const auto& todo : todo_items_) {
        if (todo.title.empty()) {
            continue;
        }
        cJSON* item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "id", todo.id.c_str());
        cJSON_AddStringToObject(item, "title", todo.title.c_str());
        cJSON_AddBoolToObject(item, "completed", todo.completed);
        cJSON_AddItemToArray(items, item);
    }
    cJSON_AddItemToObject(root, "items", items);

    char* text = cJSON_PrintUnformatted(root);
    if (text != nullptr) {
        const size_t length = std::strlen(text);
        Settings nvs(kLanMicNamespace, true);
        if (length <= kCachedTodoStateMaxBytes) {
            nvs.SetString(kCachedTodoStateKey, text);
        } else {
            ESP_LOGW(kTag,
                     "Cached todo state too large (%u bytes), not saving",
                     static_cast<unsigned>(length));
            nvs.EraseKey(kCachedTodoStateKey);
        }
        cJSON_free(text);
    }
    cJSON_Delete(root);
}

void LanMicApp::LoadPendingTodoOps() {
    Settings nvs(kLanMicNamespace);
    const std::string serialized = nvs.GetString(kPendingTodoOpsKey, "");
    if (serialized.empty()) {
        return;
    }

    cJSON* root = cJSON_Parse(serialized.c_str());
    if (!cJSON_IsArray(root)) {
        if (root != nullptr) {
            cJSON_Delete(root);
        }
        ESP_LOGW(kTag, "Ignoring corrupt pending todo ops");
        Settings writable(kLanMicNamespace, true);
        writable.EraseKey(kPendingTodoOpsKey);
        return;
    }

    pending_todo_ops_.clear();
    cJSON* item = nullptr;
    cJSON_ArrayForEach(item, root) {
        const char* type = GetJsonString(item, "type");
        const char* id = GetJsonString(item, "id");
        if (type == nullptr || id == nullptr || id[0] == '\0') {
            continue;
        }
        PendingTodoOp op;
        if (std::strcmp(type, "toggle") == 0) {
            op.type = PendingTodoOpType::Toggle;
            op.completed = GetJsonBool(item, "completed", false);
        } else if (std::strcmp(type, "delete") == 0) {
            op.type = PendingTodoOpType::Delete;
            op.completed = false;
        } else {
            continue;
        }
        op.id = id;
        pending_todo_ops_.push_back(op);
    }
    cJSON_Delete(root);

    if (!pending_todo_ops_.empty()) {
        ESP_LOGI(kTag, "Loaded %u pending todo ops",
                 static_cast<unsigned>(pending_todo_ops_.size()));
    }
}

void LanMicApp::SavePendingTodoOps() {
    Settings nvs(kLanMicNamespace, true);
    if (pending_todo_ops_.empty()) {
        nvs.EraseKey(kPendingTodoOpsKey);
        return;
    }

    cJSON* root = cJSON_CreateArray();
    for (const auto& op : pending_todo_ops_) {
        if (op.id.empty()) {
            continue;
        }
        cJSON* item = cJSON_CreateObject();
        cJSON_AddStringToObject(
            item,
            "type",
            op.type == PendingTodoOpType::Toggle ? "toggle" : "delete");
        cJSON_AddStringToObject(item, "id", op.id.c_str());
        if (op.type == PendingTodoOpType::Toggle) {
            cJSON_AddBoolToObject(item, "completed", op.completed);
        }
        cJSON_AddItemToArray(root, item);
    }

    char* text = cJSON_PrintUnformatted(root);
    if (text != nullptr) {
        nvs.SetString(kPendingTodoOpsKey, text);
        cJSON_free(text);
    }
    cJSON_Delete(root);
}

void LanMicApp::OpenTodoMenu(TodoMenuKind kind) {
    if (has_pending_transcript_ || phase_ == Phase::Recording || phase_ == Phase::Transcribing) {
        return;
    }
    todo_menu_kind_ = kind;
    todo_menu_selected_item_ = 0;
    todo_menu_open_ = true;
    active_page_ = kind == TodoMenuKind::Live ? Page::Summary : Page::Todo;
    UpdateDisplay();
}

void LanMicApp::CloseTodoMenu() {
    todo_menu_open_ = false;
    todo_menu_kind_ = TodoMenuKind::Todo;
    todo_menu_selected_item_ = 0;
    UpdateDisplay();
}

int LanMicApp::GetTodoMenuItemCount() const {
    if (todo_menu_kind_ == TodoMenuKind::ReconnectStuck) {
        return 4;
    }
    if (todo_menu_kind_ == TodoMenuKind::TodoAction) {
        return 3;
    }
    if (todo_menu_kind_ == TodoMenuKind::Live) {
        return 2;  // 对话页 BOOT 菜单：清屏、返回
    }
    return 6;
}

std::string LanMicApp::GetTodoMenuItemLabel(int item) const {
    if (todo_menu_kind_ == TodoMenuKind::ReconnectStuck) {
        switch (item) {
            case 0:
                return "Retry host";
            case 1:
                return "Offline Todo";
            case 2:
                return "Restart device";
            case 3:
                return "Back";
            default:
                return "";
        }
    }

    if (todo_menu_kind_ == TodoMenuKind::Live) {
        // 对话页 BOOT 菜单：清屏/返回（动态显示选中状态）
        const bool selected = (item == todo_menu_selected_item_);
        switch (item) {
            case 0:
                return selected ? "[x] 清屏" : "[ ] 清屏";
            case 1:
                return selected ? "[x] 返回" : "[ ] 返回";
            default:
                return "";
        }
    }

    if (todo_menu_kind_ == TodoMenuKind::TodoAction) {
        const bool has_item =
            !todo_items_.empty() &&
            todo_selected_index_ >= 0 &&
            todo_selected_index_ < static_cast<int>(todo_items_.size());
        const bool is_done = has_item && todo_items_[todo_selected_index_].completed;
        switch (item) {
            case 0:
                return is_done ? "Mark not done" : "Mark done";
            case 1:
                return "Delete selected";
            case 2:
                return "Back";
            default:
                return "";
        }
    }

    const bool has_item =
        !todo_items_.empty() &&
        todo_selected_index_ >= 0 &&
        todo_selected_index_ < static_cast<int>(todo_items_.size());
    const bool is_done = has_item && todo_items_[todo_selected_index_].completed;
    switch (item) {
        case 0:
            return is_done ? "Mark not done" : "Mark done";
        case 1:
            return "Delete selected";
        case 2:
            return "Go Live";
        case 3:
            return "Reconnect host";
        case 4:
            return "Restart device";
        case 5:
            return "Back";
        default:
            return "";
    }
}

void LanMicApp::HandleTodoMenuInput(bool up_click, bool down_click, bool boot_press) {
    const int item_count = GetTodoMenuItemCount();
    if (item_count <= 0) {
        return;
    }
    if (up_click) {
        todo_menu_selected_item_ = (todo_menu_selected_item_ + item_count - 1) % item_count;
        UpdateDisplay();
    } else if (down_click) {
        todo_menu_selected_item_ = (todo_menu_selected_item_ + 1) % item_count;
        UpdateDisplay();
    } else if (boot_press) {
        ExecuteTodoMenuItem(todo_menu_selected_item_);
    }
}

void LanMicApp::ExecuteTodoMenuItem(int item) {
    auto restart_device = [this]() {
        if (!pending_todo_ops_.empty()) {
            status_text_ = "Pending sync";
            hint_text_ = "Reconnect before restart";
            CloseTodoMenu();
            return;
        }
        status_text_ = "Restarting";
        hint_text_ = "Reconnecting host";
        UpdateDisplay();
        vTaskDelay(pdMS_TO_TICKS(300));
        esp_restart();
    };

    if (todo_menu_kind_ == TodoMenuKind::ReconnectStuck) {
        switch (item) {
            case 0:
                if (connect_attempt_running_.load(std::memory_order_acquire)) {
                    status_text_ = "Reconnect stuck";
                    hint_text_ = "Choose Offline or Restart";
                    UpdateDisplay();
                } else {
                    CloseTodoMenu();
                    RequestReconnect("Retrying host...");
                }
                return;
            case 1:
                EnterOfflineTodoMode("Offline Todo");
                return;
            case 2:
                restart_device();
                return;
            case 3:
            default:
                CloseTodoMenu();
                return;
        }
    }

    if (todo_menu_kind_ == TodoMenuKind::Live) {
        // 对话页 BOOT 菜单执行
        switch (item) {
            case 0:
                // 清屏：清空 chat_history_ 并刷新
                chat_history_.clear();
                latest_assistant_text_.clear();
                transcript_text_.clear();
                has_pending_transcript_ = false;
                summary_scroll_offset_ = 0;
                CloseTodoMenu();
                UpdateDisplay();
                return;
            case 1:
            default:
                // 返回：关闭菜单
                CloseTodoMenu();
                return;
        }
    }

    if (todo_menu_kind_ == TodoMenuKind::TodoAction) {
        switch (item) {
            case 0:
                ToggleSelectedTodo();
                CloseTodoMenu();
                return;
            case 1:
                DeleteSelectedTodo();
                CloseTodoMenu();
                return;
            case 2:
            default:
                CloseTodoMenu();
                return;
        }
    }

    const bool online = IsServerConnected();
    switch (item) {
        case 0:
            ToggleSelectedTodo();
            CloseTodoMenu();
            return;
        case 1:
            DeleteSelectedTodo();
            CloseTodoMenu();
            return;
        case 2:
            CloseTodoMenu();
            SwitchPage(Page::Summary);
            if (!online) {
                pending_normal_after_reconnect_ = true;
                RequestReconnect("Reconnecting live...");
            }
            return;
        case 3:
            CloseTodoMenu();
            RequestReconnect(online ? "Refreshing host..." : "Retrying host...");
            return;
        case 4:
            restart_device();
            return;
        case 5:
        default:
            CloseTodoMenu();
            return;
    }
}

void LanMicApp::EnterOfflineTodoMode(const std::string& message) {
    DisconnectWebSocket();
    board_.SetPowerSaveLevel(PowerSaveLevel::LOW_POWER);
    offline_todo_mode_ = true;
    reconnect_stuck_prompt_ = connect_attempt_running_.load(std::memory_order_acquire);
    todo_menu_open_ = false;
    active_page_ = Page::Todo;
    network_state_ = IsWifiConnected() ? NetworkState::Wifi : NetworkState::Offline;
    phase_ = Phase::Idle;
    status_text_ = "Offline Todo";
    hint_text_ = "";
    todo_last_action_text_ = message;
    UpdateDisplay();
}

void LanMicApp::RequestReconnect(const std::string& message) {
    board_.SetPowerSaveLevel(PowerSaveLevel::BALANCED);
    if (!IsWifiConnected()) {
        network_state_ = NetworkState::Offline;
        status_text_ = "No WiFi";
        hint_text_ = "Open settings";
        UpdateDisplay();
        return;
    }
    if (connect_attempt_running_.load(std::memory_order_acquire)) {
        status_text_ = "Reconnecting";
        hint_text_ = "Waiting; restart if stuck";
        UpdateDisplay();
        return;
    }

    if (IsServerConnected()) {
        DisconnectWebSocket();
    }
    offline_todo_mode_ = false;
    network_state_ = NetworkState::Wifi;
    status_text_ = "Connecting";
    hint_text_ = message;
    phase_ = Phase::Idle;
    StartConnectAttemptAsync();
    UpdateDisplay();
}

void LanMicApp::SwitchPage(Page page) {
    if (has_pending_transcript_ || active_page_ == page) {
        return;
    }
    active_page_ = page;
    offline_todo_mode_ = page == Page::Todo ? offline_todo_mode_ : false;
    todo_menu_open_ = false;
    settings_editing_volume_ = false;
    battery_preview_active_ = false;  // 退出设置页时关闭电池预览
    if (page == Page::Todo || page == Page::Summary) {
        SyncVoiceModeToPage(page);
    }

    // 使用 LVGL UI 管理器切换页面（如果已初始化）
    if (ui_manager_) {
        ui::PageId ui_page = ui::PageId::Chat;  // 默认对话页
        switch (page) {
            case Page::Summary: ui_page = ui::PageId::Chat; break;
            case Page::Todo:    ui_page = ui::PageId::Todo; break;
            case Page::Log:     ui_page = ui::PageId::Log; break;
            case Page::Weather: ui_page = ui::PageId::Weather; break;
            case Page::LifeBar: ui_page = ui::PageId::LifeBar; break;
            case Page::Almanac: ui_page = ui::PageId::Almanac; break;
            case Page::Settings: ui_page = ui::PageId::Settings; break;
            default: ui_page = ui::PageId::Chat; break;
        }
        ui_manager_->SwitchPage(ui_page);
    } else {
        // 回退到 raw draw 模式
        const bool full_screen_page = (page == Page::LifeBar ||
                                        page == Page::Almanac ||
                                        page == Page::Weather ||
                                        page == Page::Countdown);
        if (full_screen_page && display_ != nullptr) {
            display_->RequestUrgentFullRefresh();
        }
        UpdateDisplay();
    }
}

void LanMicApp::EnterSettings() {
    if (has_pending_transcript_) {
        return;
    }
    if (active_page_ != Page::Settings) {
        active_page_ = Page::Settings;
        todo_menu_open_ = false;
        settings_selected_item_ = 0;
        settings_editing_volume_ = false;
        battery_preview_active_ = false;  // 关闭电池预览
        // 进入设置页时强制全屏刷新，清除残留图像
        if (display_ != nullptr) {
            display_->RequestUrgentFullRefresh();
        }
        UpdateDisplay();
    }
}

void LanMicApp::SaveVolume() {
    Settings nvs(kLanMicNamespace, true);
    nvs.SetInt(kVolumeKey, volume_);
}

void LanMicApp::SaveBatteryStyle() {
    Settings nvs(kLanMicNamespace, true);
    nvs.SetInt(kBatteryStyleKey, battery_vertical_ ? 1 : 0);
}

// ============================================================
// 倒计时功能实现
// ============================================================

void LanMicApp::TryExtractTimerJson(const char* text) {
    if (text == nullptr || strlen(text) == 0) {
        return;
    }

    std::string str(text);

    // 防呆处理：剥离 Markdown 标签
    // 1. 移除 ```json 开头标签
    size_t pos = str.find("```json");
    if (pos != std::string::npos) {
        str.erase(pos, 7);  // 删除 "```json"
    }
    // 2. 移除 ``` 结尾标签
    pos = str.find("```");
    while (pos != std::string::npos) {
        str.erase(pos, 3);
        pos = str.find("```", pos);
    }

    // 3. 搜索 {" 开始位置和 } 结束位置
    size_t start = str.find("{\"");
    if (start == std::string::npos) {
        // 尝试不带引号的格式
        start = str.find("{");
        if (start == std::string::npos) {
            return;
        }
    }

    // 找到最后一个 } 作为结束位置
    size_t end = str.rfind("}");
    if (end == std::string::npos || end <= start) {
        return;
    }

    // 截取有效 JSON 内容
    std::string json_str = str.substr(start, end - start + 1);

    ESP_LOGI(kTag, "Extracted timer JSON: %s", json_str.c_str());

    // 解析 JSON
    cJSON* root = cJSON_Parse(json_str.c_str());
    if (root == nullptr) {
        ESP_LOGW(kTag, "Failed to parse extracted timer JSON");
        return;
    }

    // 检查是否为 timer 类型
    const char* type = GetJsonString(root, "type");
    if (type == nullptr || strcmp(type, "timer") != 0) {
        cJSON_Delete(root);
        return;
    }

    // 获取 duration 和 label
    cJSON* duration_json = cJSON_GetObjectItemCaseSensitive(root, "duration");
    const char* label = GetJsonString(root, "label");

    if (cJSON_IsNumber(duration_json) && duration_json->valueint > 0) {
        StartCountdown(duration_json->valueint, label != nullptr ? label : "");
    }

    cJSON_Delete(root);
}

void LanMicApp::StartCountdown(int duration_seconds, const std::string& label) {
    countdown_state_.duration_seconds = duration_seconds;
    countdown_state_.remaining_seconds = duration_seconds;
    countdown_state_.label = label;
    countdown_state_.active = true;
    countdown_state_.alarming = false;
    countdown_state_.alarm_count = 0;
    countdown_state_.started_at_ms = esp_timer_get_time() / 1000;
    countdown_state_.last_alarm_at_ms = 0;

    // 切换到倒计时页面
    active_page_ = Page::Countdown;
    phase_ = Phase::Idle;
    status_text_ = "倒计时";
    hint_text_ = "按任意键停止";

    ESP_LOGI(kTag, "Countdown started: %d seconds, label: '%s'",
             duration_seconds, label.c_str());

    // 开始提示音
    PlayBeep(880, 100);
    PlayBeep(1100, 150);

    UpdateDisplay();
}

void LanMicApp::StopCountdown() {
    countdown_state_.active = false;
    countdown_state_.alarming = false;
    countdown_state_.alarm_count = 0;

    // 返回对话页面
    active_page_ = Page::Summary;
    status_text_ = "倒计时已停止";
    hint_text_ = "";

    ESP_LOGI(kTag, "Countdown stopped");

    // 停止提示音
    PlayBeep(400, 200);

    UpdateDisplay();
}

void LanMicApp::UpdateCountdown() {
    if (!countdown_state_.active || countdown_state_.alarming) {
        return;
    }

    const int64_t now_ms = esp_timer_get_time() / 1000;
    const int64_t elapsed_ms = now_ms - countdown_state_.started_at_ms;
    const int elapsed_seconds = static_cast<int>(elapsed_ms / 1000);

    countdown_state_.remaining_seconds =
        countdown_state_.duration_seconds - elapsed_seconds;

    // 归零时触发提醒
    if (countdown_state_.remaining_seconds <= 0) {
        countdown_state_.remaining_seconds = 0;
        countdown_state_.alarming = true;
        countdown_state_.last_alarm_at_ms = now_ms;
        TriggerCountdownAlarm();
    }
}

void LanMicApp::TriggerCountdownAlarm() {
    ESP_LOGI(kTag, "Countdown alarm triggered, count: %d", countdown_state_.alarm_count);

    // 播放提示音（叮/哔）
    PlayBeep(1200, 150);
    PlayBeep(1400, 200);
    PlayBeep(1200, 150);

    countdown_state_.alarm_count++;

    // 更新显示
    UpdateDisplay();
}

void LanMicApp::HandleCountdownInput(bool any_key) {
    if (any_key) {
        // 任意键停止提醒或倒计时
        StopCountdown();
    }
}

std::string LanMicApp::FormatCountdownTime(int seconds) const {
    int mins = seconds / 60;
    int secs = seconds % 60;
    char buf[20];
    snprintf(buf, sizeof(buf), "%02d:%02d", mins, secs);
    return std::string(buf);
}

// ============================================================
// 人生进度条功能实现
// ============================================================

void LanMicApp::UpdateLifeBarState() {
    // 获取当前时间
    time_t now = time(nullptr);
    struct tm* tm_now = localtime(&now);

    if (tm_now == nullptr) {
        return;
    }

    // 年进度
    lifebar_state_.year = tm_now->tm_year + 1900;
    lifebar_state_.day_of_year = tm_now->tm_yday + 1;  // tm_yday 从 0 开始

    // 计算全年天数（闰年判断）
    const int year = lifebar_state_.year;
    const bool is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    lifebar_state_.days_in_year = is_leap ? 366 : 365;

    lifebar_state_.year_pct = static_cast<float>(lifebar_state_.day_of_year) /
                               static_cast<float>(lifebar_state_.days_in_year) * 100.0f;
    lifebar_state_.year_label = std::to_string(lifebar_state_.year) + " 年已过";

    // 月进度
    lifebar_state_.month = tm_now->tm_mon + 1;
    lifebar_state_.day_of_month = tm_now->tm_mday;

    // 计算当月天数
    const int month_days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    lifebar_state_.days_in_month = month_days[tm_now->tm_mon];
    if (tm_now->tm_mon == 1 && is_leap) {
        lifebar_state_.days_in_month = 29;  // 闰年二月
    }

    lifebar_state_.month_pct = static_cast<float>(lifebar_state_.day_of_month) /
                                static_cast<float>(lifebar_state_.days_in_month) * 100.0f;
    lifebar_state_.month_label = std::to_string(lifebar_state_.month) + "月";

    // 周进度
    lifebar_state_.weekday = tm_now->tm_wday == 0 ? 7 : tm_now->tm_wday;  // tm_wday: 0=周日, 1-6=周一-周六
    lifebar_state_.week_pct = static_cast<float>(lifebar_state_.weekday) / 7.0f * 100.0f;
    lifebar_state_.week_label = "本周";

    // 人生进度（基于年龄，默认30岁，预期寿命80岁）
    // 从 NVS 读取用户配置的年龄，如果没有则使用默认值
    Settings age_settings("lifebar", false);
    lifebar_state_.age = age_settings.GetInt("age", 30);
    lifebar_state_.life_expect = age_settings.GetInt("life_expect", 80);

    lifebar_state_.life_pct = static_cast<float>(lifebar_state_.age) /
                               static_cast<float>(lifebar_state_.life_expect) * 100.0f;

    ESP_LOGI(kTag, "LifeBar updated: year=%.1f%% month=%.1f%% week=%.1f%% life=%.1f%%",
             lifebar_state_.year_pct, lifebar_state_.month_pct,
             lifebar_state_.week_pct, lifebar_state_.life_pct);
}

std::string LanMicApp::FormatProgressBar(float pct, int width) const {
    // 生成进度条字符串，使用 █ 和 ░ 字符
    // 墨水屏适配：█ = 全填充，░ = 半填充/空白
    std::string bar;

    const int filled = static_cast<int>(pct * width / 100.0f);
    const int empty = width - filled;

    // 填充部分
    for (int i = 0; i < filled; ++i) {
        bar += "█";
    }
    // 空白部分
    for (int i = 0; i < empty; ++i) {
        bar += "░";
    }

    return bar;
}

void LanMicApp::DrawLifeBarPage(std::vector<Display::TextItem>& texts) {
    // 人生进度条布局 (400x300) - 墨水屏美化版
    // 使用边框符号模拟反显/框选效果

    constexpr int kYearLabelY = 50;
    constexpr int kYearPctY = 75;
    constexpr int kYearBarY = 100;
    constexpr int kMonthWeekY = 130;
    constexpr int kMonthWeekBarY = 155;
    constexpr int kSeparatorY = 180;
    constexpr int kLifeLabelY = 200;
    constexpr int kLifePctY = 225;
    constexpr int kLifeBarY = 250;
    constexpr int kQuoteY = 280;

    // 顶部边框
    texts.push_back({"┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓", 8, 40, 14});

    // 年进度（框选标题）
    texts.push_back({"【" + lifebar_state_.year_label + "】", 12, kYearLabelY, 16});

    // 大百分比显示（框选效果）
    char pct_buf[16];
    snprintf(pct_buf, sizeof(pct_buf), "%.1f%%", lifebar_state_.year_pct);
    texts.push_back({"┃ " + std::string(pct_buf) + " ┃", 280, kYearPctY, 24});  // 大号字体加边框

    // 年进度条（宽度 320）
    std::string year_bar = FormatProgressBar(lifebar_state_.year_pct, 40);
    texts.push_back({"│" + year_bar + "│", 12, kYearBarY, 16});

    // 分隔线
    texts.push_back({"├─────────────────────────────────┤", 8, kSeparatorY - 20, 14});

    // 月/周 双列（框选）
    texts.push_back({"【月】", 12, kMonthWeekY, 16});
    snprintf(pct_buf, sizeof(pct_buf), "%.1f%%", lifebar_state_.month_pct);
    texts.push_back({pct_buf, 70, kMonthWeekY, 16});
    std::string month_bar = FormatProgressBar(lifebar_state_.month_pct, 15);
    texts.push_back({"┃" + month_bar + "┃", 12, kMonthWeekBarY, 14});

    texts.push_back({"【周】", 210, kMonthWeekY, 16});
    snprintf(pct_buf, sizeof(pct_buf), "%.1f%%", lifebar_state_.week_pct);
    texts.push_back({pct_buf, 270, kMonthWeekY, 16});
    std::string week_bar = FormatProgressBar(lifebar_state_.week_pct, 15);
    texts.push_back({"┃" + week_bar + "┃", 210, kMonthWeekBarY, 14});

    // 分隔线
    texts.push_back({"├─────────────────────────────────┤", 8, kSeparatorY, 14});

    // 人生进度条（重点框选）
    texts.push_back({"┏━━【人生】━━━━━━━━━━━━━━━━━━━━━━━┓", 8, kLifeLabelY - 10, 16});
    snprintf(pct_buf, sizeof(pct_buf), "%.1f%%", lifebar_state_.life_pct);
    texts.push_back({"┃     " + std::string(pct_buf) + "     ┃", 140, kLifePctY, 24});
    std::string life_bar = FormatProgressBar(lifebar_state_.life_pct, 40);
    texts.push_back({"┃" + life_bar + "┃", 12, kLifeBarY, 16});

    // 底部边框
    texts.push_back({"┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛", 8, kQuoteY - 10, 14});

    // 底部引言
    texts.push_back({"— Time Flies", 160, kQuoteY, 14});
}

// ============================================================
// 老黄历功能实现
// ============================================================

void LanMicApp::UpdateAlmanacState() {
    // 获取当前时间
    time_t now = time(nullptr);
    struct tm* tm_now = localtime(&now);

    if (tm_now == nullptr) {
        return;
    }

    almanac_state_.year = tm_now->tm_year + 1900;
    almanac_state_.month = tm_now->tm_mon + 1;
    almanac_state_.day = tm_now->tm_mday;

    // 农历计算（简化版，使用预定义的农历日期对应）
    // 这里使用一个简化的农历日期计算，实际应该使用完整的农历算法
    // 由于 ESP32 内存有限，这里使用近似计算

    // 星期
    const char* weekdays[] = {"周日", "周一", "周二", "周三", "周四", "周五", "周六"};
    almanac_state_.weekday_cn = weekdays[tm_now->tm_wday];

    // 农历月份和日期（简化：基于一个固定的农历基准日）
    // 实际应该使用完整的农历算法库
    // 这里使用占位符，等待 LLM 数据填充
    almanac_state_.month_cn = GetLunarMonthName(almanac_state_.month);

    // 计算农历日期（简化版）
    const int lunar_day_approx = almanac_state_.day - 10;  // 简化计算
    almanac_state_.lunar_date = almanac_state_.month_cn + GetLunarDayName(
        std::clamp(lunar_day_approx, 1, 30));

    // 节气（基于年日数）
    almanac_state_.solar_term = GetSolarTerm(tm_now->tm_yday + 1);

    ESP_LOGI(kTag, "Almanac updated: %d-%d-%d, lunar: %s, term: %s",
             almanac_state_.year, almanac_state_.month, almanac_state_.day,
             almanac_state_.lunar_date.c_str(), almanac_state_.solar_term.c_str());
}

std::string LanMicApp::GetLunarMonthName(int month) const {
    const char* months[] = {
        "正月", "二月", "三月", "四月", "五月", "六月",
        "七月", "八月", "九月", "十月", "十一月", "腊月"
    };
    return months[std::clamp(month - 1, 0, 11)];
}

std::string LanMicApp::GetLunarDayName(int day) const {
    const char* days[] = {
        "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
        "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
        "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"
    };
    return days[std::clamp(day - 1, 0, 29)];
}

std::string LanMicApp::GetSolarTerm(int day_of_year) const {
    // 24 节气日期（近似，每年略有变化）
    // 小寒、大寒、立春、雨水、惊蛰、春分、清明、谷雨、立夏、小满、芒种、夏至
    // 小暑、大暑、立秋、处暑、白露、秋分、寒露、霜降、立冬、小雪、大雪、冬至
    struct TermDate { int start; int end; const char* name; };
    static const TermDate terms[] = {
        {1, 5, "小寒"}, {6, 20, "大寒"}, {21, 35, "立春"}, {36, 50, "雨水"},
        {51, 55, "惊蛰"}, {56, 80, "春分"}, {81, 85, "清明"}, {86, 100, "谷雨"},
        {101, 105, "立夏"}, {106, 120, "小满"}, {121, 125, "芒种"}, {126, 150, "夏至"},
        {151, 155, "小暑"}, {156, 185, "大暑"}, {186, 190, "立秋"}, {191, 205, "处暑"},
        {206, 210, "白露"}, {211, 225, "秋分"}, {226, 230, "寒露"}, {231, 245, "霜降"},
        {246, 250, "立冬"}, {251, 265, "小雪"}, {266, 270, "大雪"}, {271, 365, "冬至"}
    };

    for (const auto& t : terms) {
        if (day_of_year >= t.start && day_of_year <= t.end) {
            return t.name;
        }
    }
    return "";
}

void LanMicApp::RequestAlmanacLlmData() {
    // 通过 WebSocket 发送请求，让后端调用 LLM 生成黄历内容
    if (!IsServerConnected()) {
        ESP_LOGW(kTag, "Server not connected, cannot request almanac LLM data");
        almanac_state_.yi = "读书、远行";
        almanac_state_.ji = "动土";
        almanac_state_.direction = "东南";
        almanac_state_.health_tip = "注意养生";
        almanac_state_.has_llm_data = false;
        return;
    }

    // 发送请求 JSON
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "almanac_request");
    cJSON_AddNumberToObject(root, "year", almanac_state_.year);
    cJSON_AddNumberToObject(root, "month", almanac_state_.month);
    cJSON_AddNumberToObject(root, "day", almanac_state_.day);
    cJSON_AddStringToObject(root, "lunar_date", almanac_state_.lunar_date.c_str());
    cJSON_AddStringToObject(root, "solar_term", almanac_state_.solar_term.c_str());

    char* json_str = cJSON_PrintUnformatted(root);
    SendJson(json_str);
    free(json_str);
    cJSON_Delete(root);

    ESP_LOGI(kTag, "Almanac LLM request sent");
}

void LanMicApp::DrawAlmanacPage(std::vector<Display::TextItem>& texts) {
    // 老黄历布局 (400x300) - 墨水屏美化版
    // 使用边框符号模拟反显/框选效果

    constexpr int kLeftX = 12;
    constexpr int kRightX = 200;
    constexpr int kTopY = 50;

    // 顶部边框
    texts.push_back({"┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓", 8, 40, 14});

    // ===== 左列：日期区（框选效果）=====
    texts.push_back({"┌──────────┐", kLeftX, kTopY - 10, 14});
    texts.push_back({"│" + almanac_state_.lunar_date + "│", kLeftX + 5, kTopY, 24});  // 大号字体加边框

    // 日期数字（大号框选）
    texts.push_back({"┃ " + std::to_string(almanac_state_.day) + " ┃", kLeftX, kTopY + 35, 32});

    // 月份星期
    texts.push_back({almanac_state_.month_cn + " " + almanac_state_.weekday_cn, kLeftX + 50, kTopY + 75, 16});
    texts.push_back({"└──────────┘", kLeftX, kTopY + 95, 14});

    // 节气（框选）
    if (!almanac_state_.solar_term.empty()) {
        texts.push_back({"【" + almanac_state_.solar_term + "】", kLeftX + 20, kTopY + 115, 20});
    }

    // ===== 右列：宜忌区（框选效果）=====
    texts.push_back({"┏━━【宜】━━┓", kRightX, kTopY, 16});
    texts.push_back({"┃ " + almanac_state_.yi + " ┃", kRightX, kTopY + 20, 16});
    texts.push_back({"┗━━━━━━━━━┛", kRightX, kTopY + 40, 14});

    texts.push_back({"┏━━【忌】━━┓", kRightX, kTopY + 55, 16});
    texts.push_back({"┃ " + almanac_state_.ji + " ┃", kRightX, kTopY + 75, 16});
    texts.push_back({"┗━━━━━━━━━┛", kRightX, kTopY + 95, 14});

    // 吉方养生
    texts.push_back({"【吉方】" + almanac_state_.direction, kRightX, kTopY + 115, 16});
    texts.push_back({almanac_state_.health_tip, kRightX, kTopY + 140, 14});

    // 底部边框
    texts.push_back({"┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛", 8, 270, 14});

    // 底部来源
    texts.push_back({"— " + almanac_state_.solar_term, 160, 285, 14});
}

// ============================================================
// 天气看板功能实现
// ============================================================

void LanMicApp::UpdateWeatherState() {
    // 天气数据从后端服务获取，这里先使用默认值
    // 实际数据通过 HandleServerMessage 接收

    if (!weather_state_.has_data) {
        // 默认值
        weather_state_.city = "杭州";
        weather_state_.today_temp = 23;
        weather_state_.today_desc = "晴";
        weather_state_.today_low = 18;
        weather_state_.today_high = 28;
        weather_state_.today_humidity = 45;
        weather_state_.today_wind_dir = "东北风";
        weather_state_.today_wind_level = 3;
        weather_state_.sunrise = "06:15";
        weather_state_.sunset = "18:30";
        weather_state_.advice = "早晚温差大，记得带件外套";

        // 默认预报
        weather_state_.forecast.clear();
        weather_state_.forecast.push_back({"明天", "晴", 15});
        weather_state_.forecast.push_back({"周三", "多云", 12});
        weather_state_.forecast.push_back({"周四", "雨", 10});
    }

    ESP_LOGI(kTag, "Weather state updated: %s %d°C", weather_state_.city.c_str(), weather_state_.today_temp);
}

void LanMicApp::RequestWeatherData() {
    if (!IsServerConnected()) {
        ESP_LOGW(kTag, "Server not connected, cannot request weather data");
        weather_state_.has_data = false;
        UpdateWeatherState();  // 使用默认值
        return;
    }

    // 发送天气请求
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "weather_request");

    char* json_str = cJSON_PrintUnformatted(root);
    SendJson(json_str);
    free(json_str);
    cJSON_Delete(root);

    ESP_LOGI(kTag, "Weather request sent");
}

void LanMicApp::DrawWeatherPage(std::vector<Display::TextItem>& texts) {
    // 天气看板布局 (400x300) - 使用 FontAwesome 图标
    // spec_v3_icon_font.md

    constexpr int kCityY = 50;
    constexpr int kLeftX = 12;
    constexpr int kRightX = 220;
    constexpr int kMainY = 80;
    constexpr int kInfoY = 200;
    constexpr int kAdviceY = 260;

    // 顶部：位置图标 + 城市名
    texts.push_back({FONT_ZECTRIX_WEATHER_LOCATION, 12, kCityY, 20});  // 📍
    texts.push_back({weather_state_.city, 36, kCityY, 20});

    // ===== 主天气显示 =====
    // 根据天气描述自动选择 FontAwesome 图标
    std::string weather_icon = FONT_ZECTRIX_WEATHER_SUN;  // 默认晴天
    if (weather_state_.today_desc.find("雷") != std::string::npos) {
        weather_icon = FONT_ZECTRIX_WEATHER_THUNDER;      // 🌩️ 雷暴
    } else if (weather_state_.today_desc.find("雨") != std::string::npos) {
        weather_icon = FONT_ZECTRIX_WEATHER_RAIN;         // 🌧️ 雨天
    } else if (weather_state_.today_desc.find("雪") != std::string::npos) {
        weather_icon = FONT_ZECTRIX_WEATHER_SNOW;         // ❄️ 雪天
    } else if (weather_state_.today_desc.find("云") != std::string::npos ||
               weather_state_.today_desc.find("阴") != std::string::npos) {
        weather_icon = FONT_ZECTRIX_WEATHER_CLOUD;        // ☁️ 多云
    }
    // 晴天默认使用 SUN

    // 主图标 + 温度（48px 大图标）
    texts.push_back({weather_icon, kLeftX, kMainY, 48});
    char temp_buf[16];
    snprintf(temp_buf, sizeof(temp_buf), "%d°C", weather_state_.today_temp);
    texts.push_back({temp_buf, kLeftX + 55, kMainY + 10, 36});

    // 天气描述
    texts.push_back({weather_state_.today_desc, kLeftX, kMainY + 55, 18});

    // 温度范围
    snprintf(temp_buf, sizeof(temp_buf), "%d / %d°C", weather_state_.today_low, weather_state_.today_high);
    texts.push_back({temp_buf, kLeftX, kMainY + 80, 16});

    // ===== 右列：预报卡片 =====
    texts.push_back({"━━ 未来三天 ━━", kRightX, kMainY - 10, 14});
    int forecast_y = kMainY + 10;
    for (size_t i = 0; i < weather_state_.forecast.size() && i < 3; ++i) {
        const auto& f = weather_state_.forecast[i];
        texts.push_back({f.weekday, kRightX, forecast_y, 14});

        // 预报图标选择（16px 小图标）
        std::string fc_icon = FONT_ZECTRIX_WEATHER_SUN;
        if (f.desc.find("雷") != std::string::npos) {
            fc_icon = FONT_ZECTRIX_WEATHER_THUNDER;
        } else if (f.desc.find("雨") != std::string::npos) {
            fc_icon = FONT_ZECTRIX_WEATHER_RAIN;
        } else if (f.desc.find("雪") != std::string::npos) {
            fc_icon = FONT_ZECTRIX_WEATHER_SNOW;
        } else if (f.desc.find("云") != std::string::npos || f.desc.find("阴") != std::string::npos) {
            fc_icon = FONT_ZECTRIX_WEATHER_CLOUD;
        }
        texts.push_back({fc_icon, kRightX + 50, forecast_y, 16});
        snprintf(temp_buf, sizeof(temp_buf), "%d°", f.temp);
        texts.push_back({temp_buf, kRightX + 70, forecast_y, 14});
        forecast_y += 25;
    }

    // ===== 底部信息行（带图标）=====
    // 湿度 + 体感温度
    texts.push_back({FONT_ZECTRIX_WEATHER_HUMIDITY, kLeftX, kInfoY, 16});
    snprintf(temp_buf, sizeof(temp_buf), "湿度 %d%%", weather_state_.today_humidity);
    texts.push_back({temp_buf, kLeftX + 20, kInfoY, 14});

    texts.push_back({FONT_ZECTRIX_WEATHER_TEMP, 120, kInfoY, 16});
    snprintf(temp_buf, sizeof(temp_buf), "体感 %d°C", weather_state_.today_temp);
    texts.push_back({temp_buf, 140, kInfoY, 14});

    // 风向 + 日出
    texts.push_back({FONT_ZECTRIX_WEATHER_WIND, kLeftX, kInfoY + 20, 16});
    snprintf(temp_buf, sizeof(temp_buf), "%s %d级", weather_state_.today_wind_dir.c_str(), weather_state_.today_wind_level);
    texts.push_back({temp_buf, kLeftX + 20, kInfoY + 20, 14});

    texts.push_back({FONT_ZECTRIX_WEATHER_SUNRISE, 180, kInfoY + 20, 16});
    texts.push_back({weather_state_.sunrise, 200, kInfoY + 20, 14});

    // 日落
    texts.push_back({FONT_ZECTRIX_WEATHER_SUNSET, kLeftX, kInfoY + 40, 16});
    texts.push_back({weather_state_.sunset, kLeftX + 20, kInfoY + 40, 14});

    // 穿衣建议
    texts.push_back({"────────────────────────────────", kLeftX, kInfoY + 60, 14});
    texts.push_back({weather_state_.advice, kLeftX, kAdviceY, 14});

    // 底部来源
    texts.push_back({"— QWeather", 300, kAdviceY + 20, 12});
}

// ============================================================

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
        settings_selected_item_ = (settings_selected_item_ + kSettingsItemCount - 1) % kSettingsItemCount;
        UpdateDisplay();
    } else if (down_click) {
        settings_selected_item_ = (settings_selected_item_ + 1) % kSettingsItemCount;
        UpdateDisplay();
    } else if (boot_press) {
        ExecuteSettingsItem(settings_selected_item_);
    }
}

void LanMicApp::ExecuteSettingsItem(int item) {
    switch (item) {
        case kSettingsItemWifi:
            // Wi-Fi 控制：断开/重连
            if (IsWifiConnected()) {
                // 已连接时断开 WiFi
                status_text_ = "断开 Wi-Fi...";
                hint_text_ = "";
                UpdateDisplay();
                DisconnectWebSocket();
                WifiManager::GetInstance().StopStation();
                network_state_ = NetworkState::Offline;
                status_text_ = "Wi-Fi 已断开";
            } else if (network_state_ == NetworkState::Offline) {
                // 未连接时重连 WiFi
                status_text_ = "重连 Wi-Fi...";
                hint_text_ = "";
                UpdateDisplay();
                WifiManager::GetInstance().StartStation();
            } else if (network_state_ == NetworkState::Config) {
                // 配置模式时退出并重连
                WifiManager::GetInstance().StopConfigAp();
                WifiManager::GetInstance().StartStation();
                network_state_ = NetworkState::Offline;
                status_text_ = "退出配置模式";
            }
            UpdateDisplay();
            break;
        case kSettingsItemServer:
            // 服务控制：断开/重连 WebSocket
            if (IsServerConnected()) {
                // 已连接时断开服务
                status_text_ = "断开服务...";
                hint_text_ = "";
                DisconnectWebSocket();
                phase_ = Phase::Idle;
                status_text_ = "服务已断开";
            } else if (IsWifiConnected()) {
                // WiFi 已连接但服务未连接：重连
                status_text_ = "重连服务...";
                hint_text_ = "";
                RequestReconnect("重连服务...");
            } else {
                // 无 WiFi：提示先连接 WiFi
                status_text_ = "无 Wi-Fi";
                hint_text_ = "请先连接 Wi-Fi";
            }
            UpdateDisplay();
            break;
        case kSettingsItemVolume:
            // 音量调节：进入调节模式
            settings_editing_volume_ = true;
            UpdateDisplay();
            break;
        case kSettingsItemBatteryPreview:
            // 电池预览：循环切换电量等级 (0/20/50/80/100)
            if (!battery_preview_active_) {
                battery_preview_active_ = true;
                battery_preview_level_ = 0;
            } else {
                // 循环切换: 0 → 20 → 50 → 80 → 100 → 退出
                const int levels[] = {0, 20, 50, 80, 100};
                int current_idx = 0;
                for (int i = 0; i < 5; ++i) {
                    if (battery_preview_level_ == levels[i]) {
                        current_idx = i;
                        break;
                    }
                }
                if (current_idx < 4) {
                    battery_preview_level_ = levels[current_idx + 1];
                } else {
                    // 到达 100% 后退出预览
                    battery_preview_active_ = false;
                    battery_preview_level_ = 0;
                }
            }
            UpdateDisplay();
            break;
        case kSettingsItemBatteryStyle:
            // 电池方向切换：横向 ↔ 纵向
            battery_vertical_ = !battery_vertical_;
            SaveBatteryStyle();
            UpdateDisplay();
            break;
        case kSettingsItemRestart:
            // 重启设备
            status_text_ = "重启中...";
            UpdateDisplay();
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();
            break;
        case kSettingsItemPowerOff:
            // 关机
            Shutdown();
            break;
        default:
            break;
    }
}

const char* LanMicApp::GetNetworkLabel() const {
    if (offline_todo_mode_ && network_state_ != NetworkState::Server) {
        return "离线";
    }
    switch (network_state_) {
        case NetworkState::Server:
            return "在线";  // 符合 Spec §2：WSS 建立显示"在线"
        case NetworkState::Wifi:
            return "WiFi";  // WiFi 已连接但服务未连接，显示 WiFi 状态
        case NetworkState::Config:
            return "AP";
        case NetworkState::Offline:
        default:
            return "离线";
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

const char* LanMicApp::GetModeLabel() const {
    return (active_page_ == Page::Todo || offline_todo_mode_) ? "Mode: Todo" : "Mode: Live";
}

std::string LanMicApp::GetPhaseLabel() const {
    switch (phase_) {
        case Phase::Recording:
            return "录音...";
        case Phase::Transcribing:
            return "识别...";
        case Phase::AwaitingAction:
            return "? 发送?";
        case Phase::Running:
            return "▶ AI";
        case Phase::Error:
            return "! 错误";
        case Phase::Idle:
        default:
            return "";
    }
}

bool LanMicApp::ShouldShowIdleTodoPage() const {
    return offline_todo_mode_ &&
           phase_ == Phase::Idle &&
           !has_pending_transcript_ &&
           active_page_ != Page::Log &&
           active_page_ != Page::Settings &&
           !todo_menu_open_;
}

void LanMicApp::ShowIdleTodoPage() {
    if (ShouldShowIdleTodoPage()) {
        active_page_ = Page::Todo;
    }
}

std::string LanMicApp::GetFooterText() const {
    // 新模式页面不显示底部 footer（已内置提示）
    if (active_page_ == Page::Countdown ||
        active_page_ == Page::LifeBar ||
        active_page_ == Page::Almanac ||
        active_page_ == Page::Weather) {
        return "";
    }
    // Hide footer on Summary (AI chat) page for cleaner chat UI
    if (active_page_ == Page::Summary && !has_pending_transcript_ && phase_ != Phase::Recording && !todo_menu_open_) {
        return "";
    }
    if (has_pending_transcript_) {
        return "BOOT 继续 | UP 发送 | DN 取消";
    }
    if (phase_ == Phase::Recording) {
        return "松开 BOOT 结束录音";
    }
    if (network_state_ == NetworkState::Config) {
        return "连接 AP 后访问 192.168.4.1";
    }
    if (todo_menu_open_) {
        return "UP/DN 选择 | BOOT 确认";
    }
    if (active_page_ == Page::Settings) {
        return "";  // 设置页面已内置提示，不显示 footer
    }
    if (active_page_ == Page::Todo) {
        return IsServerConnected()
            ? "长按 UP 菜单 | 长按 Todo"
            : "长按 UP 菜单 | UP/DN 选择";
    }
    return "UP/DN 滚动 | 长按 切换页";
}

std::string LanMicApp::BuildPromptBody() const {
    if (!transcript_text_.empty()) {
        return transcript_text_;
    }
    if (!hint_text_.empty()) {
        return hint_text_;
    }
    if (offline_todo_mode_) {
        return "Offline Todo cache";
    }
    // Default hint based on connection state
    switch (network_state_) {
        case NetworkState::Server:
            return active_page_ == Page::Todo
                ? "Todo voice mode\nHold UP for menu"
                : "Live coding mode\nHold UP for menu";
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
            ZectrixSetFactoryLedOverride(true, true);   // blink only while actively recording
            break;
        case Phase::Error:
            ZectrixSetFactoryLedOverride(true, false);  // keep LED off; error is shown on e-paper
            break;
        case Phase::Transcribing:
        case Phase::Running:
        case Phase::AwaitingAction:
            ZectrixSetFactoryLedOverride(true, false);  // keep LED off; status is shown on e-paper
            break;
        case Phase::Idle:
        default:
            ZectrixSetFactoryLedOverride(true, false);  // suppress distracting charge blink
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
    // 根据 WiFi 连接状态选择不同图标
    const uint8_t* icon_data = nullptr;
    size_t icon_len = 0;

    // 判断 WiFi 是否已连接
    const bool wifi_connected = IsWifiConnected();
    const bool server_connected = IsServerConnected();

    if (!wifi_connected) {
        // WiFi 未连接：显示带叉图标
        icon_data = kWifiIconDisconnected12x12;
        icon_len = sizeof(kWifiIconDisconnected12x12);
    } else if (wifi_connected && !server_connected) {
        // WiFi 已连接但服务器未连接：显示连接中图标（闪烁效果）
        const int64_t now_ms = esp_timer_get_time() / 1000;
        const bool blink_on = (now_ms / 500) % 2 == 0;  // 每 500ms 交替
        if (blink_on) {
            icon_data = kWifiIconConnecting12x12;
            icon_len = sizeof(kWifiIconConnecting12x12);
        } else {
            icon_data = kWifiIconDisconnected12x12;
            icon_len = sizeof(kWifiIconDisconnected12x12);
        }
    } else {
        // 服务器已连接：显示实心图标
        icon_data = kWifiIconConnected12x12;
        icon_len = sizeof(kWifiIconConnected12x12);
    }

    display_->WriteRaw1bpp(x, y, 12, 12, icon_data, icon_len);
}

void LanMicApp::DrawBatteryIcon(int x, int y, int level, bool charging, bool vertical) {
    if (display_ == nullptr) {
        return;
    }

    // 根据方向选择尺寸
    const int w = vertical ? 10 : 18;
    const int h = vertical ? 18 : 10;
    const int bytes_per_row = (w + 7) / 8;
    std::vector<uint8_t> buffer(bytes_per_row * h, 0x00);

    auto set_pixel = [&buffer, bytes_per_row, w, h](int px, int py, bool black) {
        if (px < 0 || px >= w || py < 0 || py >= h) return;
        const int byte_idx = py * bytes_per_row + (px / 8);
        const int bit_idx = 7 - (px % 8);
        if (black) {
            buffer[byte_idx] |= (1 << bit_idx);
        } else {
            buffer[byte_idx] &= ~(1 << bit_idx);
        }
    };

    if (vertical) {
        // 纵向电池 (10x18)，电池头在顶部，内部 3 格水平分隔
        // 外框（矩形边框 1px）
        for (int px = 0; px < w; ++px) {
            set_pixel(px, 2, true);       // 主体顶部边框
            set_pixel(px, h - 1, true);   // 底部边框
        }
        for (int py = 2; py < h; ++py) {
            set_pixel(0, py, true);       // 左边框
            set_pixel(w - 1, py, true);   // 右边框
        }

        // 电池头（顶部突出的小矩形）
        for (int px = 2; px < w - 2; ++px) {
            set_pixel(px, 0, true);  // 电池头顶部
            set_pixel(px, 1, true);  // 电池头底部
        }

        // 内部 3 格分隔线（水平线）
        const int body_height = h - 3;  // 主体高度 (15)
        const int cell_height = body_height / 3;  // 每格高度约 5px
        for (int px = 1; px < w - 1; ++px) {
            set_pixel(px, 2 + cell_height, true);      // 第1格底边界
            set_pixel(px, 2 + cell_height * 2, true);  // 第2格底边界
        }

        // 计算填充格数：0-33% 1格, 34-66% 2格, 67-100% 3格
        int filled_cells = 0;
        if (level >= 67) filled_cells = 3;
        else if (level >= 34) filled_cells = 2;
        else if (level > 0) filled_cells = 1;

        // 填充格子（从底部向上）
        for (int cell = 0; cell < filled_cells; ++cell) {
            int cell_start = h - 1 - cell * cell_height - cell_height;
            int cell_end = h - 1 - cell * cell_height;
            for (int py = cell_start + 1; py < cell_end; ++py) {
                for (int px = 1; px < w - 1; ++px) {
                    set_pixel(px, py, true);
                }
            }
        }

        // 充电状态：在中间格显示闪电符号
        if (charging) {
            int cy = 2 + cell_height + cell_height / 2;  // 中间格中心
            set_pixel(3, cy - 2, true);
            set_pixel(4, cy - 1, true);
            set_pixel(2, cy, true);
            set_pixel(5, cy + 1, true);
            set_pixel(4, cy + 2, true);
            set_pixel(3, cy + 3, true);
        }
    } else {
        // 横向电池 (18x10)，电池头在右侧，内部 3 格垂直分隔
        // 外框（矩形边框 1px）
        for (int px = 0; px < w - 2; ++px) {
            set_pixel(px, 0, true);       // 顶部边框
            set_pixel(px, h - 1, true);   // 底部边框
        }
        for (int py = 0; py < h; ++py) {
            set_pixel(0, py, true);       // 左边框
            set_pixel(w - 3, py, true);   // 右边框（电池头在右端）
        }

        // 电池头（右侧突出的小矩形）
        for (int py = 2; py < h - 2; ++py) {
            set_pixel(w - 2, py, true);  // 电池头左部
            set_pixel(w - 1, py, true);  // 电池头右部
        }

        // 内部 3 格分隔线（垂直线）
        const int cell_width = (w - 3) / 3;  // 每格宽度约 5px
        for (int py = 1; py < h - 1; ++py) {
            set_pixel(cell_width, py, true);      // 第1格右边界
            set_pixel(cell_width * 2, py, true);  // 第2格右边界
        }

        // 计算填充格数：0-33% 1格, 34-66% 2格, 67-100% 3格
        int filled_cells = 0;
        if (level >= 67) filled_cells = 3;
        else if (level >= 34) filled_cells = 2;
        else if (level > 0) filled_cells = 1;

        // 填充格子（从左到右）
        for (int cell = 0; cell < filled_cells; ++cell) {
            int cell_start = 1 + cell * cell_width;
            int cell_end = cell_start + cell_width - 1;
            for (int px = cell_start; px < cell_end; ++px) {
                for (int py = 1; py < h - 1; ++py) {
                    set_pixel(px, py, true);
                }
            }
        }

        // 充电状态：在中间格显示闪电符号
        if (charging) {
            int cx = cell_width + cell_width / 2;  // 中间格中心
            set_pixel(cx - 1, 2, true);
            set_pixel(cx, 3, true);
            set_pixel(cx - 2, 4, true);
            set_pixel(cx + 1, 5, true);
            set_pixel(cx, 6, true);
            set_pixel(cx - 1, 7, true);
        }
    }

    // 低电量警告 (<20%): 反白显示
    if (level < 20 && !charging) {
        for (size_t i = 0; i < buffer.size(); ++i) {
            buffer[i] = ~buffer[i];
        }
    }

    display_->WriteRaw1bpp(x, y, w, h, buffer.data(), buffer.size());
}

// 绘制气泡边框或实心填充（符合 Spec v3）
// filled=true: 用户消息（实心填充黑底，需要配合 InvertRegion 实现白字）
// filled=false: AI消息（边框）
void LanMicApp::DrawBubble(int x, int y, int w, int h, bool filled, int radius) {
    if (display_ == nullptr || w <= 0 || h <= 0) {
        return;
    }

    const int bytes_per_row = (w + 7) / 8;
    std::vector<uint8_t> buffer(bytes_per_row * h, 0x00);
    const int r = std::min(radius, std::min(w / 2, h / 2));

    auto set_pixel = [&buffer, bytes_per_row, w, h](int px, int py, bool black) {
        if (px < 0 || px >= w || py < 0 || py >= h) return;
        const int byte_idx = py * bytes_per_row + (px / 8);
        const int bit_idx = 7 - (px % 8);
        if (black) {
            buffer[byte_idx] |= (1 << bit_idx);
        } else {
            buffer[byte_idx] &= ~(1 << bit_idx);
        }
    };

    // 判断像素是否在圆角矩形内部
    auto is_inside = [w, h, r](int px, int py) {
        const bool in_corner =
            (px < r && py < r) ||
            (px >= w - r && py < r) ||
            (px < r && py >= h - r) ||
            (px >= w - r && py >= h - r);

        if (in_corner) {
            int cx, cy;
            if (px < r && py < r) { cx = r - 1; cy = r - 1; }
            else if (px >= w - r && py < r) { cx = w - r; cy = r - 1; }
            else if (px < r && py >= h - r) { cx = r - 1; cy = h - r; }
            else { cx = w - r; cy = h - r; }
            const int dist_sq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
            return dist_sq <= r * r;
        }
        return true;  // 非圆角区域都在内部
    };

    if (filled) {
        // 用户消息：实心填充（黑色）
        for (int py = 0; py < h; ++py) {
            for (int px = 0; px < w; ++px) {
                if (is_inside(px, py)) {
                    set_pixel(px, py, true);  // 填充黑色
                }
            }
        }
    } else {
        // AI消息：边框（1px）
        for (int py = 0; py < h; ++py) {
            for (int px = 0; px < w; ++px) {
                if (!is_inside(px, py)) continue;

                const bool in_corner =
                    (px < r && py < r) ||
                    (px >= w - r && py < r) ||
                    (px < r && py >= h - r) ||
                    (px >= w - r && py >= h - r);

                bool draw_border = false;
                if (in_corner) {
                    int cx, cy;
                    if (px < r && py < r) { cx = r - 1; cy = r - 1; }
                    else if (px >= w - r && py < r) { cx = w - r; cy = r - 1; }
                    else if (px < r && py >= h - r) { cx = r - 1; cy = h - r; }
                    else { cx = w - r; cy = h - r; }
                    const int dist_sq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
                    const int r_sq = r * r;
                    const int inner_r_sq = (r - 1) * (r - 1);
                    if (dist_sq <= r_sq && dist_sq > inner_r_sq) {
                        draw_border = true;
                    }
                } else {
                    if (px == 0 || px == w - 1 || py == 0 || py == h - 1) {
                        draw_border = true;
                    }
                }

                if (draw_border) {
                    set_pixel(px, py, true);
                }
            }
        }
    }

    display_->WriteRaw1bpp(x, y, w, h, buffer.data(), buffer.size());
}

void LanMicApp::UpdateDisplay() {
    UpdateLed();

    if (display_ == nullptr) {
        return;
    }

    // 如果 LVGL UI 管理器已初始化，使用 LVGL widget
    if (ui_manager_) {
        UpdateLvglDisplay();
        return;
    }

    // 以下是旧的 raw draw 实现（回退模式）
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

    // 存储气泡绘制信息（位置、大小、是否用户消息）- DrawTexts后绘制
    std::vector<std::tuple<int, int, int, int, bool>> pending_bubbles;  // (x, y, w, h, is_user)

    // 新模式页面使用全屏布局，不显示状态栏图标但显示标题
    const bool full_screen_page = (active_page_ == Page::Countdown ||
                                     active_page_ == Page::LifeBar ||
                                     active_page_ == Page::Almanac ||
                                     active_page_ == Page::Weather);

    // 全屏页面标题（显示在顶部中间）
    if (full_screen_page) {
        const char* page_title = active_page_ == Page::LifeBar ? "人生进度"
                               : active_page_ == Page::Almanac ? "老黄历"
                               : active_page_ == Page::Weather ? "天气看板"
                               : active_page_ == Page::Countdown ? "倒计时"
                               : "未知";
        texts.push_back({page_title, 180, 9, 16});  // 标题在顶部中间
    }

    // 状态栏布局优化（仅非全屏页面）
    // WiFi 图标: x=10, y=6 (12x12)
    // 网络状态文本: x=28, y=9
    // Phase 标签: x=150, y=9
    // 电池百分比: x=352, y=8 (格式: "85%")
    // 电池图标: x=380, y=4 (竖向 10x18)

    if (!full_screen_page) {
        texts.push_back({GetNetworkLabel(), 28, 9, 16});

        // 显示服务状态（在 WiFi 已连接但服务器未连接时显示）
        if (IsWifiConnected() && !IsServerConnected() && !offline_todo_mode_) {
            texts.push_back({"服务离线", 96, 9, 16});
        }

        texts.push_back({GetPhaseLabel(), 150, 9, 16});

        // 电池百分比显示（格式: "85%" 或 "--%"）
        std::string battery_pct_text = battery_known_ ?
            std::to_string(std::clamp(battery_level_, 0, 100)) + "%" : "--%";
        // 低电量警告时加叹号
        if (battery_known_ && battery_level_ < 20 && !battery_charging_) {
            battery_pct_text = "!" + battery_pct_text;
        }
        // 根据电池方向调整百分比位置：横向 (y=8)，纵向 (y=5)
        int pct_y = battery_vertical_ ? 5 : 8;
        texts.push_back({battery_pct_text, 340, pct_y, 16});

        const char* page_label = active_page_ == Page::Summary ? "对话"
                               : active_page_ == Page::Todo    ? "Todo"
                               : active_page_ == Page::Log     ? "日志"
                               : active_page_ == Page::Countdown ? "倒计时"
                               : active_page_ == Page::LifeBar ? "进度"
                               : active_page_ == Page::Almanac ? "黄历"
                               : active_page_ == Page::Weather ? "天气"
                               :                                 "设置";
        texts.push_back({single_line(repo_name_.empty() ? "AI" : repo_name_, 18), 12, kContentHeaderY, 16});
        // 将页面标签移到中间位置（符合用户需求）
        texts.push_back({page_label, 180, kContentHeaderY, 16});
    }

    if (active_page_ == Page::Summary) {
        if (todo_menu_open_ && todo_menu_kind_ == TodoMenuKind::Live) {
            texts.push_back({"Live Menu", 12, kPromptTitleY, 16});
            texts.push_back({single_line(GetModeLabel(), 16), 228, kPromptTitleY, 16});
            std::vector<std::string> rows;
            const int count = GetTodoMenuItemCount();
            for (int index = 0; index < count; ++index) {
                std::string row = (index == todo_menu_selected_item_) ? "> " : "  ";
                row += GetTodoMenuItemLabel(index);
                rows.push_back(single_line(row, kBodyCharsPerLine));
            }
            int y = kPromptBodyY;
            for (const auto& row : rows) {
                texts.push_back({row, 12, y, 16});
                y += kLineHeight;
            }
        } else {
            // Chat conversation mode: 真正的气泡布局（符合 Spec §3）
            // 用户消息：右侧对齐，实心气泡（filled=true）
            // AI消息：左侧对齐，边框气泡（filled=false）
            constexpr int kChatStartY = 72;  // Start after header line
            constexpr int kChatEndY = 264;   // Before footer (footer hidden on Summary)
            constexpr size_t kChatVisibleLines = (kChatEndY - kChatStartY) / kLineHeight;  // ~10 lines
            constexpr int kMarginX = 12;     // 左右边距（AI消息左对齐）
            constexpr int kMarginXRight = 0;   // 用户消息右边距（紧贴右边缘）
            constexpr int kBubbleMargin = 4; // 气泡内边距

            // Build all lines from chat history
            std::vector<std::pair<std::string, bool>> chat_lines;  // (text, is_user)

            // 录音/识别/运行状态时：隐藏历史消息，保持界面干净（符合 Spec §3）
            const bool hide_history = (phase_ == Phase::Recording ||
                                       phase_ == Phase::Transcribing ||
                                       phase_ == Phase::Running);

            // Add history messages only when not in active state
            if (!hide_history) {
                for (const auto& msg : chat_history_) {
                    const auto wrapped = WrapUtf8Lines(msg.text, kBodyCharsPerLine, 0);
                    for (const auto& line : wrapped) {
                        chat_lines.push_back({line, msg.role == ChatRole::User});
                    }
                }
            }

            // Add current transient content with status hints (符合 Spec §3)
            if (phase_ == Phase::Recording) {
                // 录音状态：右侧显示 "正在录音..."
                chat_lines.push_back({"正在录音...", true});
            } else if (phase_ == Phase::Transcribing) {
                chat_lines.push_back({"识别中...", true});
            } else if (phase_ == Phase::Running) {
                if (latest_assistant_text_.empty()) {
                    chat_lines.push_back({"正在思考...", false});
                } else {
                    const auto wrapped = WrapUtf8Lines(latest_assistant_text_, kBodyCharsPerLine, 0);
                    for (const auto& line : wrapped) {
                        chat_lines.push_back({line, false});
                    }
                }
            } else if (has_pending_transcript_ && !transcript_text_.empty()) {
                const auto wrapped = WrapUtf8Lines(transcript_text_, kBodyCharsPerLine, 0);
                for (const auto& line : wrapped) {
                    chat_lines.push_back({line, true});
                }
            } else if (chat_history_.empty() && phase_ == Phase::Idle) {
                std::string hint = hint_text_.empty() ? "按 BOOT 键开始对话" : hint_text_;
                const auto wrapped = WrapUtf8Lines(hint, kBodyCharsPerLine, kChatVisibleLines);
                for (const auto& line : wrapped) {
                    chat_lines.push_back({line, false});  // System hint on left
                }
            }

            // Auto-scroll to bottom (show latest messages)
            const int total_lines = static_cast<int>(chat_lines.size());
            const int max_offset = std::max(0, total_lines - static_cast<int>(kChatVisibleLines));
            bool at_bottom = summary_scroll_offset_ >= max_offset - 1 || summary_scroll_offset_ < 0;
            const int display_offset = at_bottom ? max_offset : std::clamp(summary_scroll_offset_, 0, max_offset);
            summary_scroll_offset_ = display_offset;

            // Render lines with real bubble drawing
            int y = kChatStartY;
            for (int i = display_offset; i < total_lines && y < kChatEndY; ++i) {
                const auto& [line, is_user] = chat_lines[i];

                // 使用精确的文字宽度计算（中文 16px，ASCII 8px）
                const int text_width = CalculateTextWidth(line);
                const int bubble_width = text_width + kBubbleMargin * 2;
                const int bubble_height = kLineHeight + 2;

                int x_pos, bubble_x;
                if (is_user) {
                    // 用户消息：右对齐，紧贴右边缘（kMarginXRight=0）
                    x_pos = 400 - kMarginXRight - text_width - kBubbleMargin;
                    bubble_x = 400 - kMarginXRight - bubble_width;
                } else {
                    // AI/系统消息：左对齐
                    x_pos = kMarginX + kBubbleMargin;
                    bubble_x = kMarginX;
                }

                // 收集气泡信息，等 DrawTexts 后绘制（避免被清屏覆盖）
                // 用户消息：实心填充 (filled=true)，需要反色实现白字
                // AI消息：边框 (filled=false)
                pending_bubbles.push_back({bubble_x, y, bubble_width, bubble_height, is_user});

                // 在气泡内绘制文本（位置调整为气泡内部）
                texts.push_back({line, x_pos, y, 16});
                y += kLineHeight;
            }
        }
    } else if (active_page_ == Page::Todo) {
        texts.push_back({todo_menu_open_ ? "Todo Menu" : "Todo", 12, kLogTitleY, 16});
        std::string todo_status = todo_last_action_text_.empty() ? GetModeLabel() : todo_last_action_text_;
        if (!pending_todo_ops_.empty()) {
            todo_status = "Pending sync " + std::to_string(pending_todo_ops_.size());
        }
        texts.push_back({single_line(todo_status, 16), 228, kLogTitleY, 16});

        std::vector<std::string> rows;
        if (todo_menu_open_) {
            if (todo_menu_kind_ == TodoMenuKind::ReconnectStuck) {
                rows.push_back("Reconnect stuck");
            } else if (todo_menu_kind_ == TodoMenuKind::TodoAction) {
                rows.push_back("Todo actions");
            } else if (!IsServerConnected()) {
                rows.push_back("Offline Todo");
            } else {
                rows.push_back(GetModeLabel());
            }
            const int count = GetTodoMenuItemCount();
            for (int index = 0; index < count; ++index) {
                std::string row = (index == todo_menu_selected_item_) ? "> " : "  ";
                row += GetTodoMenuItemLabel(index);
                rows.push_back(single_line(row, kBodyCharsPerLine));
            }
        } else if (todo_items_.empty()) {
            rows.push_back("No plans yet");
            rows.push_back(IsServerConnected() ? "Hold UP for menu" : "Offline cache empty");
            rows.push_back(GetModeLabel());
        } else {
            const int visible_lines = static_cast<int>(kLogVisibleLines);
            const int max_start = std::max(0, static_cast<int>(todo_items_.size()) - visible_lines);
            const int start_index = std::clamp(
                todo_selected_index_ < 0 ? 0 : todo_selected_index_ - (visible_lines / 2),
                0,
                max_start);
            const int end_index = std::min(
                static_cast<int>(todo_items_.size()),
                start_index + visible_lines);
            for (int index = start_index; index < end_index; ++index) {
                const auto& item = todo_items_[index];
                std::string row = (index == todo_selected_index_) ? ">" : " ";
                row += std::to_string(index + 1);
                row += ".";
                row += item.completed ? "[x] " : "[ ] ";
                row += item.title;
                rows.push_back(single_line(row, kBodyCharsPerLine));
            }
        }

        int y = kLogBodyY;
        for (const auto& line : rows) {
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
    } else if (active_page_ == Page::Settings) {
        // Settings page - 扁平化汉化菜单 + 图标（符合 spec_v3_icon_font.md）
        texts.push_back({std::string(FONT_ZECTRIX_ICON_SETTING) + " 设置", 12, kLogTitleY, 16});

        // 构建菜单项（全汉化 + 图标）
        std::vector<std::pair<std::string, std::string>> items;  // (icon, label)

        // Wi-Fi 状态控制（显示实际 SSID）
        std::string wifi_label;
        if (network_state_ == NetworkState::Offline) {
            wifi_label = "未连接";
        } else if (network_state_ == NetworkState::Config) {
            wifi_label = "配置模式";
        } else if (IsWifiConnected()) {
            // 已连接时显示实际 SSID
            std::string ssid = WifiManager::GetInstance().GetSsid();
            wifi_label = ssid.empty() ? "已连接" : ssid;
        } else {
            wifi_label = "连接中";
        }
        items.push_back({FONT_ZECTRIX_WIFI_FULL, "Wi-Fi: " + wifi_label});

        // 服务状态控制
        std::string server_label;
        if (!IsWifiConnected()) {
            server_label = "无网络";
        } else if (IsServerConnected()) {
            server_label = "在线";
        } else {
            server_label = "离线";
        }
        items.push_back({FONT_ZECTRIX_ICON_SYNC, "服务: " + server_label});

        // 音量调节
        std::string vol_label = "音量: " + std::to_string(volume_) + "%";
        if (settings_editing_volume_) {
            vol_label += " [调节中]";
        }
        items.push_back({FONT_ZECTRIX_ICON_SPEAKER, vol_label});

        // 电池预览调试
        std::string battery_preview_label = "电池预览";
        if (battery_preview_active_) {
            battery_preview_label += " [" + std::to_string(battery_preview_level_) + "%]";
        }
        items.push_back({FONT_ZECTRIX_ICON_POWER, battery_preview_label});

        // 电池方向切换
        std::string battery_style_label = "电池方向: ";
        battery_style_label += battery_vertical_ ? "纵向" : "横向";
        items.push_back({FONT_ZECTRIX_ICON_POWER, battery_style_label});

        // 重启设备
        items.push_back({FONT_ZECTRIX_ICON_REBOOT, "重启设备"});

        // 关机
        items.push_back({FONT_ZECTRIX_ICON_POWER, "关机"});

        int y = kLogBodyY;
        for (size_t i = 0; i < items.size(); ++i) {
            // 选中状态用 [x] 标记，未选中用 [ ] 标记
            std::string row = (static_cast<int>(i) == settings_selected_item_) ? "[x] " : "[ ] ";
            row += items[i].second;  // 只显示文本，图标单独渲染

            // 先绘制图标（16px）
            texts.push_back({items[i].first, 16, y + 2, 16});  // icon at x=16
            // 再绘制文本（选中标记 + 标签）
            texts.push_back({row, 36, y, 16});  // text at x=36
            y += kLineHeight + 4;  // 紧凑间距，提高可读性
        }

        // 底部操作提示
        if (settings_editing_volume_) {
            texts.push_back({"UP/DN ±10  BOOT 保存", 12, kFooterTextY - 16, 14});
        } else if (battery_preview_active_) {
            texts.push_back({"BOOT 切换电量等级", 12, kFooterTextY - 16, 14});
        } else {
            texts.push_back({"UP/DN 选择  BOOT 执行", 12, kFooterTextY - 16, 14});
        }
    }

    // 倒计时页面 (Page::Countdown)
    if (active_page_ == Page::Countdown) {
        // 中央大号字体显示剩余时间，下方显示事项标签

        // 剩余时间字符串（格式 MM:SS）
        std::string time_str = FormatCountdownTime(countdown_state_.remaining_seconds);

        // 标签文本
        std::string label_text = countdown_state_.label.empty() ?
            "倒计时" : countdown_state_.label;

        // 提醒状态显示
        std::string status_text;
        if (countdown_state_.alarming) {
            status_text = "时间到了！";
            // 提醒时闪烁效果（时间文字反白）
            time_str = "★" + time_str + "★";
        } else {
            status_text = "进行中...";
        }

        // 计算居中位置
        // 400x300 屏幕，时间显示在中央偏上
        constexpr int kTimeY = 100;      // 时间显示 Y 坐标
        constexpr int kLabelY = 150;     // 标签显示 Y 坐标
        constexpr int kStatusY = 180;    // 状态显示 Y 坐标
        constexpr int kHintY = 240;      // 提示显示 Y 坐标

        // 大号字体显示时间（24px）
        // 居中：400px宽度，每个字符约12px宽（24px字体）
        int time_x = (400 - time_str.size() * 12) / 2;
        time_x = std::max(10, time_x);
        texts.push_back({time_str, time_x, kTimeY, 24});

        // 标签显示（16px）
        int label_x = (400 - label_text.size() * 8) / 2;
        label_x = std::max(10, label_x);
        texts.push_back({label_text, label_x, kLabelY, 16});

        // 状态显示
        int status_x = (400 - status_text.size() * 8) / 2;
        status_x = std::max(10, status_x);
        texts.push_back({status_text, status_x, kStatusY, 16});

        // 提示文本
        std::string hint = countdown_state_.alarming ?
            "按任意键停止提醒" : "按任意键取消";
        texts.push_back({hint, 12, kHintY, 14});

        // 提醒次数显示
        if (countdown_state_.alarming) {
            std::string alarm_info = "提醒 " + std::to_string(countdown_state_.alarm_count) + "/5 次";
            texts.push_back({alarm_info, 280, kHintY, 14});
        }
    }

    // 新增 InkSight 模式页面
    if (active_page_ == Page::LifeBar) {
        // 人生进度条页面
        UpdateLifeBarState();
        DrawLifeBarPage(texts);
    } else if (active_page_ == Page::Almanac) {
        // 老黄历页面
        UpdateAlmanacState();
        DrawAlmanacPage(texts);
    } else if (active_page_ == Page::Weather) {
        // 天气看板页面
        UpdateWeatherState();
        DrawWeatherPage(texts);
    }

    const std::string footer_text = GetFooterText();
    if (!footer_text.empty()) {
        texts.push_back({footer_text, 12, kFooterTextY, 16});
    }

    display_->DrawTexts(texts, true);

    // 气泡绘制顺序（实现黑底白字）：
    // 1. 先绘制用户气泡实心黑色
    // 2. DrawTexts 已绘制文字（黑色）
    // 3. 对用户气泡区域反色（文字变白）
    // 4. 绘制 AI 气泡边框
    constexpr int kBubbleRadius = 4;
    for (const auto& [bx, by, bw, bh, is_user] : pending_bubbles) {
        if (is_user) {
            // 用户气泡：实心填充 + 反色实现黑底白字
            DrawBubble(bx, by, bw, bh, true, kBubbleRadius);
            display_->InvertRegion(bx, by, bw, bh);
        }
    }
    // AI 气泡：边框（在用户气泡之后绘制，避免覆盖）
    for (const auto& [bx, by, bw, bh, is_user] : pending_bubbles) {
        if (!is_user) {
            DrawBubble(bx, by, bw, bh, false, kBubbleRadius);
        }
    }

    // 状态栏分隔线仅显示在非全屏页面
    if (!full_screen_page) {
        DrawHorizontalLine(kStatusBarBottomY);
    }
    // 新模式页面使用全屏布局，不绘制标题分隔线和状态栏图标
    if (!full_screen_page) {
        DrawHorizontalLine(kHeaderLineY);
    }
    // Only draw footer separator when footer is visible and not full screen
    if (!footer_text.empty() && !full_screen_page) {
        DrawHorizontalLine(kFooterTopY);
    }
    // 状态栏图标仅显示在非全屏页面
    if (!full_screen_page) {
        DrawWifiIcon(10, 6);  // WiFi 图标 (12x12) 在 y=6
        // 电池图标（预览模式时显示预览等级）
        int display_battery_level = battery_preview_active_ ? battery_preview_level_ : (battery_known_ ? battery_level_ : 0);
        bool display_battery_charging = battery_preview_active_ ? false : battery_charging_;
        // 根据电池方向调整坐标：横向 18x10 (y=4)，纵向 10x18 (y=0)
        int battery_y = battery_vertical_ ? 0 : 4;
        DrawBatteryIcon(380, battery_y, display_battery_level, display_battery_charging, battery_vertical_);
    }
    display_->RequestUrgentRefresh();
}

void LanMicApp::UpdateLvglDisplay() {
    if (!ui_manager_) return;

    // 先更新状态栏
    ui::StatusBarData status_data;
    const char* titles[] = {"对话", "Todo", "日志", "人生进度", "老黄历", "天气", "设置"};
    status_data.page_title = titles[static_cast<int>(ui_manager_->GetCurrentPage())];
    status_data.wifi_connected = IsWifiConnected();
    status_data.server_connected = IsServerConnected();
    status_data.battery_level = battery_known_ ? battery_level_ : -1;
    status_data.battery_charging = battery_charging_;
    ui_manager_->UpdateStatusBar(status_data);

    // 获取当前页面并更新数据
    ui::PageId current_page = ui_manager_->GetCurrentPage();

    switch (current_page) {
        case ui::PageId::Chat: {
            ui::ChatPage* chat_page = ui_manager_->GetChatPage();
            if (chat_page) {
                // 清空现有消息
                chat_page->Clear();

                // 添加历史消息
                for (const auto& msg : chat_history_) {
                    ui::ChatRole role = (msg.role == ChatRole::User) ?
                        ui::ChatRole::User : ui::ChatRole::AI;
                    chat_page->AddMessage(msg.text, role);
                }

                // 添加当前状态提示
                if (phase_ == Phase::Recording) {
                    chat_page->ShowStatus("正在录音...", ui::ChatRole::User);
                } else if (phase_ == Phase::Transcribing) {
                    chat_page->ShowStatus("识别中...", ui::ChatRole::User);
                } else if (phase_ == Phase::Running) {
                    if (latest_assistant_text_.empty()) {
                        chat_page->ShowStatus("正在思考...", ui::ChatRole::AI);
                    } else {
                        chat_page->AddMessage(latest_assistant_text_, ui::ChatRole::AI);
                    }
                } else if (has_pending_transcript_ && !transcript_text_.empty()) {
                    chat_page->AddMessage(transcript_text_, ui::ChatRole::User);
                } else if (chat_history_.empty() && phase_ == Phase::Idle) {
                    std::string hint = hint_text_.empty() ?
                        "按 BOOT 键开始对话" : hint_text_;
                    chat_page->ShowStatus(hint, ui::ChatRole::System);
                }
            }
            break;
        }

        case ui::PageId::Weather: {
            ui::WeatherPage* weather_page = ui_manager_->GetWeatherPage();
            if (weather_page && weather_state_.has_data) {
                ui::WeatherData data;
                data.city = weather_state_.city;
                data.temp = std::to_string(weather_state_.today_temp) + "°C";
                data.condition = weather_state_.today_desc;
                data.humidity = "湿度: " + std::to_string(weather_state_.today_humidity) + "%";
                data.wind = weather_state_.today_wind_dir +
                    " " + std::to_string(weather_state_.today_wind_level) + "级";
                weather_page->UpdateWeather(data);
            }
            break;
        }

        case ui::PageId::LifeBar: {
            ui::LifeBarPage* lifebar_page = ui_manager_->GetLifeBarPage();
            if (lifebar_page) {
                UpdateLifeBarState();
                ui::LifeBarData data;
                data.age = std::to_string(lifebar_state_.age);
                data.goal = "人生进度";
                data.progress = std::to_string(static_cast<int>(lifebar_state_.life_pct)) + "%";
                lifebar_page->UpdateData(data);
            }
            break;
        }

        case ui::PageId::Almanac: {
            ui::AlmanacPage* almanac_page = ui_manager_->GetAlmanacPage();
            if (almanac_page) {
                UpdateAlmanacState();
                ui::AlmanacData data;
                data.date = std::to_string(almanac_state_.year) + "/" +
                    std::to_string(almanac_state_.month) + "/" +
                    std::to_string(almanac_state_.day);
                data.lunar_date = almanac_state_.lunar_date;
                data.suit = almanac_state_.yi;
                data.avoid = almanac_state_.ji;
                data.auspicious = almanac_state_.direction;
                almanac_page->UpdateData(data);
            }
            break;
        }

        case ui::PageId::Settings: {
            ui::SettingsPage* settings_page = ui_manager_->GetSettingsPage();
            if (settings_page) {
                // 构建设置项列表
                std::vector<ui::SettingsItem> items;

                // Wi-Fi 状态
                std::string wifi_label;
                if (network_state_ == NetworkState::Offline) {
                    wifi_label = "未连接";
                } else if (network_state_ == NetworkState::Config) {
                    wifi_label = "配置模式";
                } else if (IsWifiConnected()) {
                    wifi_label = WifiManager::GetInstance().GetSsid();
                    if (wifi_label.empty()) wifi_label = "已连接";
                } else {
                    wifi_label = "连接中";
                }
                items.push_back({"Wi-Fi", wifi_label, ui::SettingsItemType::Normal, false, [this]() { EnterWifiSetupMode(); }});

                // 服务状态
                std::string server_label = IsServerConnected() ? "在线" : "离线";
                items.push_back({"服务", server_label, ui::SettingsItemType::Normal, false, nullptr});

                // 音量
                items.push_back({"音量", std::to_string(volume_) + "%", ui::SettingsItemType::Normal, false, nullptr});

                // 电池预览调试（Spec v2 要求）
                std::string battery_preview_value;
                if (battery_preview_active_) {
                    battery_preview_value = "[" + std::to_string(battery_preview_level_) + "%]";
                }
                items.push_back({"电池预览", battery_preview_value, ui::SettingsItemType::Normal, false, [this]() {
                    // 循环切换电池等级
                    const int levels[] = {0, 20, 50, 80, 100};
                    int current_idx = 0;
                    for (int i = 0; i < 5; ++i) {
                        if (battery_preview_level_ == levels[i]) {
                            current_idx = i;
                            break;
                        }
                    }
                    if (!battery_preview_active_) {
                        battery_preview_active_ = true;
                        battery_preview_level_ = 0;
                    } else {
                        battery_preview_level_ = levels[(current_idx + 1) % 5];
                    }
                    UpdateLvglDisplay();
                }});

                // 重启
                items.push_back({"重启", "", ui::SettingsItemType::Action, false, [this]() { esp_restart(); }});

                // 关机
                items.push_back({"关机", "", ui::SettingsItemType::Action, false, [this]() { Shutdown(); }});

                settings_page->SetItems(items);
            }
            break;
        }

        case ui::PageId::Todo: {
            ui::TodoPage* todo_page = ui_manager_->GetTodoPage();
            if (todo_page) {
                todo_page->Clear();
                for (const auto& item : todo_items_) {
                    todo_page->AddItem(item.title, item.completed);
                }
                todo_page->Refresh();
            }
            break;
        }

        case ui::PageId::Log: {
            ui::LogPage* log_page = ui_manager_->GetLogPage();
            if (log_page) {
                log_page->Clear();
                for (const auto& line : cli_log_lines_) {
                    log_page->AddEntry(line, 0);  // 默认 info level
                }
                log_page->Refresh();
            }
            break;
        }

        default:
            break;
    }

    // 刷新显示
    ui_manager_->RefreshNow();
}

void LanMicApp::Run() {
    if (!Initialize()) {
        ESP_LOGE(kTag, "Initialization failed");
        while (true) {
            vTaskDelay(pdMS_TO_TICKS(1000));
        }
    }

    bool last_pressed = false;
    int64_t boot_pressed_since_ms = 0;
    bool todo_hold_started = false;
    int64_t last_reconnect_ms = 0;
    int64_t reconnect_interval_ms = kReconnectIntervalMinMs;
    int64_t last_battery_poll_ms = 0;
    int64_t last_ws_ping_ms = 0;
    int64_t awaiting_pong_since_ms = 0;
    int64_t awaiting_pong_baseline_ms = 0;
    int64_t reconnect_prompt_started_ms = 0;
    // Tracks when the current "disconnected stretch" started.
    // Initialised to now so a cold boot with no server still gets a full grace
    // period before sleeping, but reset on every disconnect so a board that had
    // been happily connected for hours does not immediately deep-sleep after
    // the very first failed reconnect attempt.
    int64_t disconnected_since_ms = esp_timer_get_time() / 1000;

    while (true) {
        const int64_t now_ms = esp_timer_get_time() / 1000;

        // 倒计时逻辑处理
        if (active_page_ == Page::Countdown) {
            // 更新倒计时
            UpdateCountdown();

            // 提醒循环（每1秒播放一次，最多5次）
            if (countdown_state_.alarming &&
                countdown_state_.alarm_count < 5 &&
                (now_ms - countdown_state_.last_alarm_at_ms) >= 1000) {
                countdown_state_.last_alarm_at_ms = now_ms;
                TriggerCountdownAlarm();
                // 提醒达到5次后自动停止
                if (countdown_state_.alarm_count >= 5) {
                    StopCountdown();
                }
            }

            // 倒计时页面按键处理
            const bool up_click = up_clicked_.exchange(false);
            const bool down_click = down_clicked_.exchange(false);
            const bool boot_press = IsPttPressed() && !last_pressed;
            if (up_click || down_click || boot_press) {
                HandleCountdownInput(true);
                vTaskDelay(pdMS_TO_TICKS(10));
                continue;
            }
        }

        if (connect_attempt_completed_.exchange(false, std::memory_order_acq_rel)) {
            reconnect_stuck_prompt_ = false;
            if (IsServerConnected()) {
                reconnect_interval_ms = kReconnectIntervalMinMs;
                disconnected_since_ms = now_ms;
                last_ws_ping_ms = 0;
                awaiting_pong_since_ms = 0;
                awaiting_pong_baseline_ms = 0;
            } else if (server_uri_.empty() && cached_server_uri_.empty() && GetFallbackServerUri().empty()) {
                reconnect_interval_ms = kReconnectIntervalMinMs;
            } else {
                reconnect_interval_ms = std::min(reconnect_interval_ms * 2, kReconnectIntervalMaxMs);
            }
        }
        const int64_t connect_attempt_started_ms =
            connect_attempt_started_ms_.load(std::memory_order_acquire);
        if (connect_attempt_running_.load(std::memory_order_acquire) &&
            connect_attempt_started_ms > 0 &&
            (now_ms - connect_attempt_started_ms) >= kConnectAttemptWatchdogMs &&
            !reconnect_stuck_prompt_) {
            ESP_LOGE(kTag,
                     "Connect attempt watchdog fired: started_ms=%lld now_ms=%lld",
                     static_cast<long long>(connect_attempt_started_ms),
                     static_cast<long long>(now_ms));
            reconnect_stuck_prompt_ = true;
            offline_todo_mode_ = true;
            todo_menu_kind_ = TodoMenuKind::ReconnectStuck;
            todo_menu_selected_item_ = 0;
            todo_menu_open_ = true;
            reconnect_prompt_started_ms = now_ms;
            status_text_ = "Reconnect stuck";
            hint_text_ = "Choose action";
            phase_ = Phase::Error;
            active_page_ = Page::Todo;
            UpdateDisplay();
        }
        if (ws_disconnected_pending_.exchange(false)) {
            hello_sent_ = false;
            network_state_ = IsWifiConnected() ? NetworkState::Wifi : NetworkState::Offline;
            status_text_ = "Disconnected";
            hint_text_ = "Will retry automatically";
            phase_ = Phase::Idle;
            if (active_page_ == Page::Todo || offline_todo_mode_) {
                offline_todo_mode_ = true;
                todo_last_action_text_ = "Offline Todo";
                active_page_ = Page::Todo;
            } else {
                active_page_ = Page::Summary;
            }
            disconnected_since_ms = now_ms;
            reconnect_interval_ms = kReconnectIntervalMinMs;
            last_reconnect_ms = 0;
            last_ws_ping_ms = 0;
            awaiting_pong_since_ms = 0;
            awaiting_pong_baseline_ms = 0;
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
            } else if (active_page_ == Page::Todo || offline_todo_mode_) {
                OpenTodoMenu(TodoMenuKind::Todo);
            } else if (active_page_ == Page::Summary) {
                OpenTodoMenu(TodoMenuKind::Live);
            } else {
                SwitchPage(Page::Todo);
            }
        }
        if (down_long_pressed_.exchange(false)) {
            if (IsNavButtonPressed(TODO_UP_BUTTON_GPIO)) {
                EnterWifiSetupMode();
            } else if (active_page_ == Page::Summary) {
                SwitchPage(Page::Todo);       // Summary → Todo
            } else if (active_page_ == Page::Todo) {
                SwitchPage(Page::Log);        // Todo → Log
            } else if (active_page_ == Page::Log) {
                SwitchPage(Page::LifeBar);    // Log → LifeBar
            } else if (active_page_ == Page::LifeBar) {
                SwitchPage(Page::Almanac);    // LifeBar → Almanac
            } else if (active_page_ == Page::Almanac) {
                SwitchPage(Page::Weather);    // Almanac → Weather
            } else if (active_page_ == Page::Weather) {
                EnterSettings();              // Weather → Settings
            } else if (active_page_ == Page::Settings) {
                SwitchPage(Page::Summary);    // Settings → Summary
            } else if (active_page_ == Page::Countdown) {
                HandleCountdownInput(true);   // Countdown: 按键停止
            }
        }

        const bool up_double_click = up_double_clicked_.exchange(false);
        const bool down_double_click = down_double_clicked_.exchange(false);
        const bool up_click = up_clicked_.exchange(false) || (todo_menu_open_ && up_double_click);
        const bool down_click = down_clicked_.exchange(false) || down_double_click;

        if (up_double_click &&
            !todo_menu_open_ &&
            !has_pending_transcript_ &&
            (active_page_ == Page::Todo || active_page_ == Page::Summary) &&
            (phase_ == Phase::Idle || phase_ == Phase::Error)) {
            SwitchPage(active_page_ == Page::Todo ? Page::Summary : Page::Todo);
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        if (active_page_ == Page::Settings) {
            const bool pressed_now = IsPttPressed();
            const bool boot_press  = pressed_now && !last_pressed;
            if (boot_press) last_pressed = true;
            if (!pressed_now) last_pressed = false;
            HandleSettingsInput(up_click, down_click, boot_press);
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        // 新模式页面按键处理：BOOT 返回对话页面
        if (active_page_ == Page::LifeBar ||
            active_page_ == Page::Almanac ||
            active_page_ == Page::Weather) {
            const bool pressed_now = IsPttPressed();
            const bool boot_press = pressed_now && !last_pressed;
            if (boot_press) {
                last_pressed = true;
                // BOOT 切换到对话页面
                SwitchPage(Page::Summary);
                vTaskDelay(pdMS_TO_TICKS(10));
                continue;
            }
            if (!pressed_now) last_pressed = false;
            // UP/DN 在新模式页面可以触发刷新（可选）
            if (up_click || down_click) {
                UpdateDisplay();
                vTaskDelay(pdMS_TO_TICKS(10));
                continue;
            }
        }

        if (todo_menu_open_) {
            if (todo_menu_kind_ == TodoMenuKind::ReconnectStuck &&
                reconnect_prompt_started_ms > 0 &&
                (now_ms - reconnect_prompt_started_ms) >= kReconnectPromptTimeoutMs) {
                reconnect_prompt_started_ms = 0;
                EnterOfflineTodoMode("Offline Todo");
                vTaskDelay(pdMS_TO_TICKS(10));
                continue;
            }
            const bool pressed_now = IsPttPressed();
            const bool boot_press  = pressed_now && !last_pressed;
            if (boot_press) last_pressed = true;
            if (!pressed_now) last_pressed = false;
            HandleTodoMenuInput(up_click, down_click, boot_press);
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        if (!IsWifiConnected() && network_state_ != NetworkState::Config) {
            if (!offline_todo_mode_ &&
                !todo_menu_open_ &&
                !has_pending_transcript_ &&
                phase_ == Phase::Idle &&
                (now_ms - disconnected_since_ms) >= kReconnectPromptTimeoutMs) {
                EnterOfflineTodoMode("Offline Todo");
                vTaskDelay(pdMS_TO_TICKS(10));
                continue;
            }
            if (offline_todo_mode_ && active_page_ == Page::Todo) {
                if (up_click) {
                    MoveTodoSelection(-1);
                }
                if (down_click) {
                    MoveTodoSelection(1);
                }
                const bool pressed_now = IsPttPressed();
                if (pressed_now && !last_pressed) {
                    last_pressed = true;
                    boot_pressed_since_ms = now_ms;
                    todo_hold_started = false;
                } else if (!pressed_now && last_pressed) {
                    if (!todo_hold_started && boot_pressed_since_ms > 0) {
                        OpenTodoMenu(TodoMenuKind::TodoAction);
                    }
                    boot_pressed_since_ms = 0;
                    todo_hold_started = false;
                    last_pressed = false;
                }
            }
            vTaskDelay(pdMS_TO_TICKS(200));
            continue;
        }

        if (!IsServerConnected() &&
            !connect_attempt_running_.load(std::memory_order_acquire) &&
            !offline_todo_mode_ &&
            (now_ms - last_reconnect_ms) >= reconnect_interval_ms) {
            last_reconnect_ms = now_ms;
            StartConnectAttemptAsync();
        }

        if (IsWifiConnected() &&
            !IsServerConnected() &&
            !connect_attempt_running_.load(std::memory_order_acquire) &&
            !offline_todo_mode_ &&
            !todo_menu_open_ &&
            !has_pending_transcript_ &&
            phase_ == Phase::Idle &&
            (now_ms - disconnected_since_ms) >= kReconnectPromptTimeoutMs) {
            reconnect_stuck_prompt_ = true;
            offline_todo_mode_ = true;
            todo_menu_kind_ = TodoMenuKind::ReconnectStuck;
            todo_menu_selected_item_ = 0;
            todo_menu_open_ = true;
            reconnect_prompt_started_ms = now_ms;
            status_text_ = "No server";
            hint_text_ = "Choose action";
            active_page_ = Page::Todo;
            UpdateDisplay();
        }

        // Time-based sleep: if no connection has been established within
        // kNoConnectionSleepMs, enter deep sleep to save battery.
        if (!IsServerConnected() &&
            !connect_attempt_running_.load(std::memory_order_acquire) &&
            !offline_todo_mode_ &&
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
            if (awaiting_pong_since_ms == 0 && (now_ms - last_ws_ping_ms) >= kClientPingIntervalMs) {
                const int64_t pong_baseline_ms = ws_->GetLastPongMs();
                last_ws_ping_ms = now_ms;
                if (!ws_->Ping()) {
                    ESP_LOGW(kTag, "WebSocket ping send failed; reconnecting");
                    const bool should_stay_offline_todo =
                        active_page_ == Page::Todo || offline_todo_mode_;
                    DisconnectWebSocket();
                    network_state_ = IsWifiConnected() ? NetworkState::Wifi : NetworkState::Offline;
                    status_text_ = "Server timeout";
                    hint_text_ = should_stay_offline_todo ? "Offline Todo" : "Retrying host...";
                    phase_ = Phase::Idle;
                    if (should_stay_offline_todo) {
                        EnterOfflineTodoMode("Offline Todo");
                    } else {
                        active_page_ = Page::Summary;
                    }
                    disconnected_since_ms = now_ms;
                    reconnect_interval_ms = kReconnectIntervalMinMs;
                    last_reconnect_ms = now_ms;
                    last_ws_ping_ms = 0;
                    awaiting_pong_since_ms = 0;
                    awaiting_pong_baseline_ms = 0;
                    if (!should_stay_offline_todo) {
                        StartConnectAttemptAsync();
                    }
                    UpdateDisplay();
                    vTaskDelay(pdMS_TO_TICKS(50));
                    continue;
                }
                awaiting_pong_since_ms = now_ms;
                awaiting_pong_baseline_ms = pong_baseline_ms;
            }
            const int64_t last_pong_ms = ws_->GetLastPongMs();
            if (awaiting_pong_since_ms > 0 && last_pong_ms > awaiting_pong_baseline_ms) {
                awaiting_pong_since_ms = 0;
                awaiting_pong_baseline_ms = 0;
            }
            const bool client_ping_timed_out =
                awaiting_pong_since_ms > 0 && (now_ms - awaiting_pong_since_ms) >= kPongTimeoutMs;
            const bool server_silent_too_long =
                awaiting_pong_since_ms == 0 &&
                last_pong_ms > 0 &&
                (now_ms - last_pong_ms) >= kServerSilenceTimeoutMs;
            if (client_ping_timed_out || server_silent_too_long) {
                ESP_LOGW(kTag,
                         "WebSocket heartbeat timed out: reason=%s last_pong_ms=%lld baseline_ms=%lld ping_ms=%lld now_ms=%lld",
                         client_ping_timed_out ? "client_ping" : "server_silence",
                         static_cast<long long>(last_pong_ms),
                         static_cast<long long>(awaiting_pong_baseline_ms),
                         static_cast<long long>(awaiting_pong_since_ms),
                         static_cast<long long>(now_ms));
                const bool should_stay_offline_todo =
                    active_page_ == Page::Todo || offline_todo_mode_;
                status_text_ = "Server timeout";
                hint_text_ = should_stay_offline_todo ? "Offline Todo" : "Retrying host...";
                phase_ = Phase::Idle;
                if (should_stay_offline_todo) {
                    EnterOfflineTodoMode("Offline Todo");
                } else {
                    DisconnectWebSocket();
                    active_page_ = Page::Summary;
                }
                network_state_ = IsWifiConnected() ? NetworkState::Wifi : NetworkState::Offline;
                disconnected_since_ms = now_ms;
                reconnect_interval_ms = kReconnectIntervalMinMs;
                last_reconnect_ms = now_ms;
                last_ws_ping_ms = 0;
                awaiting_pong_since_ms = 0;
                awaiting_pong_baseline_ms = 0;
                if (!should_stay_offline_todo) {
                    StartConnectAttemptAsync();
                }
                UpdateDisplay();
                vTaskDelay(pdMS_TO_TICKS(50));
                continue;
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
            } else if (active_page_ == Page::Todo) {
                MoveTodoSelection(-1);
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
            } else if (active_page_ == Page::Todo) {
                MoveTodoSelection(1);
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
            boot_pressed_since_ms = now_ms;
            todo_hold_started = false;
            const bool can_open_page_menu =
                phase_ == Phase::Idle || phase_ == Phase::Error;
            const bool defer_page_press =
                (active_page_ == Page::Todo || active_page_ == Page::Summary) &&
                !has_pending_transcript_ &&
                can_open_page_menu;
            if (defer_page_press) {
                last_pressed = true;
                vTaskDelay(pdMS_TO_TICKS(10));
                continue;
            }
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
                SyncVoiceModeToActivePage();
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

        if (pressed &&
            last_pressed &&
            (active_page_ == Page::Todo || active_page_ == Page::Summary) &&
            !todo_hold_started &&
            boot_pressed_since_ms > 0 &&
            !has_pending_transcript_ &&
            (phase_ == Phase::Idle || phase_ == Phase::Error) &&
            IsServerConnected() &&
            (now_ms - boot_pressed_since_ms) >= kTodoBootHoldMs) {
            if (!SyncVoiceModeToActivePage()) {
                status_text_ = "Mode error";
                hint_text_ = "Try again";
                UpdateDisplay();
                vTaskDelay(pdMS_TO_TICKS(20));
                continue;
            }
            todo_hold_started = true;
            ESP_LOGI(kTag, "PTT start from page hold");
            SendPttStart();
            phase_ = Phase::Recording;
            status_text_ = "Recording";
            hint_text_ = "Release BOOT to send";
            FlushPrerollFrames();
            StreamAudioFrame();
            UpdateDisplay();
        }

        if (!pressed && last_pressed) {
            ESP_LOGI(kTag, "BOOT release phase=%d", static_cast<int>(phase_));
            if (phase_ == Phase::Recording) {
                ESP_LOGI(kTag, "PTT stop");
                SendPttStop();
                phase_ = Phase::Transcribing;
                status_text_ = "Transcribing";
                UpdateDisplay();
            } else if (active_page_ == Page::Todo &&
                       !todo_hold_started &&
                       boot_pressed_since_ms > 0 &&
                       !has_pending_transcript_) {
                OpenTodoMenu(TodoMenuKind::TodoAction);
            }
            boot_pressed_since_ms = 0;
            todo_hold_started = false;
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
