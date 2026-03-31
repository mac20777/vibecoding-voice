#ifndef LAN_MIC_APP_H
#define LAN_MIC_APP_H

#include <atomic>
#include <memory>
#include <string>
#include <vector>

#include <driver/gpio.h>
#include <freertos/FreeRTOS.h>
#include <freertos/event_groups.h>

#include "audio_codec.h"
#include "button.h"

class Board;
class Display;
class WebSocket;

class LanMicApp {
public:
    LanMicApp();
    ~LanMicApp();

    void Run();

private:
    Board& board_;
    AudioCodec* codec_ = nullptr;
    Display* display_ = nullptr;
    std::unique_ptr<WebSocket> ws_;
    EventGroupHandle_t wifi_event_group_ = nullptr;
    Button up_button_;
    Button down_button_;
    bool hello_sent_ = false;
    std::atomic<bool> up_clicked_{false};
    std::atomic<bool> down_clicked_{false};
    std::atomic<bool> up_long_pressed_{false};
    std::atomic<bool> down_long_pressed_{false};
    bool has_pending_transcript_ = false;
    std::string send_target_;         // received from server_ready: "claude_code" | "codex_exec" | "text_injector"
    std::vector<int16_t> audio_frame_buffer_; // reused across StreamAudioFrame() calls
    enum class Phase {
        Idle,
        Recording,
        Transcribing,
        AwaitingAction,
        Running,
        Error
    };
    enum class Page {
        Summary,
        Log
    };
    enum class NetworkState {
        Offline,
        Wifi,
        Server,
        Config
    };

    Phase phase_ = Phase::Idle;
    Page active_page_ = Page::Summary;
    NetworkState network_state_ = NetworkState::Offline;
    std::string status_text_;
    std::string transcript_text_;
    std::string cli_status_text_;
    std::string cli_phase_text_;
    std::string latest_assistant_text_;
    std::string repo_name_;
    std::string server_uri_;
    std::vector<std::string> cli_log_lines_;
    std::string hint_text_;
    int quota_5h_remaining_pct_ = -1;
    int quota_week_remaining_pct_ = -1;
    int battery_level_ = 0;
    bool battery_known_ = false;
    bool battery_charging_ = false;
    bool battery_discharging_ = false;
    int summary_scroll_offset_ = 0;
    int log_scroll_offset_ = 0;

    bool Initialize();
    void ConfigureButtons();
    bool IsWifiConnected() const;
    bool EnsureWebSocketConnected();
    bool DiscoverServerUri();
    std::string MakeAuthNonce() const;
    std::string HmacSha256Hex(const std::vector<std::string>& parts) const;
    void EnterWifiSetupMode();
    void DisconnectWebSocket();
    bool IsPttPressed() const;
    bool IsNavButtonPressed(gpio_num_t gpio_num) const;
    bool SendJson(const char* json);
    bool SendHello();
    bool SendPttStart();
    bool SendPttStop();
    bool SendAction(const char* action_type);
    bool StreamAudioFrame();
    void HandleServerMessage(const char* data, size_t len);
    void RefreshBatteryStatus(bool force_update = false);
    void HandleScroll(int direction);
    void SwitchPage(Page page);
    const char* GetNetworkLabel() const;
    std::string GetPhaseLabel() const;
    const char* GetToolLabel() const;  // "Claude" | "Codex" | "Inject"
    std::string GetFooterText() const;
    std::string BuildPromptBody() const;
    std::string BuildReplyBody() const;
    std::vector<std::string> WrapText(const std::string& text, size_t max_chars) const;
    std::vector<std::string> SliceLines(const std::vector<std::string>& lines, int offset, size_t max_lines) const;
    void DrawHorizontalLine(int y, int thickness = 1);
    void DrawWifiIcon(int x, int y);
    void DrawBatteryIcon(int x, int y, int level, bool charging);
    void UpdateDisplay();
};

#endif // LAN_MIC_APP_H
