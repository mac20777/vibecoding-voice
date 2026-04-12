#ifndef LAN_MIC_APP_H
#define LAN_MIC_APP_H

#include <atomic>
#include <deque>
#include <memory>
#include <string>
#include <vector>

#include <driver/gpio.h>
#include <freertos/FreeRTOS.h>
#include <freertos/event_groups.h>
#include <freertos/task.h>

#include "audio_codec.h"
#include "board.h"
#include "button.h"
#include "display/display.h"

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
    std::atomic<bool> up_double_clicked_{false};
    std::atomic<bool> down_double_clicked_{false};
    std::atomic<bool> up_long_pressed_{false};
    std::atomic<bool> down_long_pressed_{false};
    std::atomic<bool> ws_disconnected_pending_{false};
    std::atomic<bool> connect_attempt_running_{false};
    std::atomic<bool> connect_attempt_completed_{false};
    std::atomic<bool> connect_cancel_requested_{false};
    std::atomic<int64_t> connect_attempt_started_ms_{0};
    std::atomic<bool> wifi_reconfigure_restart_pending_{false};
    TaskHandle_t connect_task_handle_ = nullptr;
    bool has_pending_transcript_ = false;
    std::string send_target_;         // received from server_ready: "claude_code" | "codex_exec" | "text_injector"
    std::vector<int16_t> audio_frame_buffer_; // reused across StreamAudioFrame() calls
    std::deque<std::vector<int16_t>> preroll_frames_;
    enum class Phase {
        Idle,
        Recording,
        Transcribing,
        AwaitingAction,
        Running,
        Error
    };
    enum class Page {
        Summary,      // 对话页面
        Todo,         // Todo 列表
        Log,          // CLI 日志
        Settings,     // 设置
        Countdown,    // 倒计时页面
        LifeBar,      // 人生进度条
        Almanac,      // 老黄历
        Weather       // 天气看板
    };
    enum class VoiceMode {
        Normal,
        Todo
    };
    enum class TodoMenuKind {
        Todo,
        TodoAction,
        Live,
        ReconnectStuck
    };
    struct TodoItem {
        std::string id;
        std::string title;
        bool completed = false;
    };
    // Chat message structure for conversation history display
    enum class ChatRole {
        User,    // User's input message (right-aligned)
        Assistant // AI's response (left-aligned)
    };
    struct ChatMessage {
        ChatRole role;
        std::string text;
    };
    // 倒计时状态
    struct CountdownState {
        int duration_seconds = 0;       // 总时长（秒）
        int remaining_seconds = 0;      // 剩余时间（秒）
        std::string label;              // 事项标签（如"泡面"）
        bool active = false;            // 是否正在进行
        bool alarming = false;          // 是否正在提醒（归零后）
        int alarm_count = 0;            // 提醒次数（最多5次）
        int64_t started_at_ms = 0;      // 开始时间戳
        int64_t last_alarm_at_ms = 0;   // 上次提醒时间戳
    };
    CountdownState countdown_state_;

    // 人生进度条状态
    struct LifeBarState {
        int year = 2026;
        int day_of_year = 0;        // 当年第几天
        int days_in_year = 365;     // 全年天数
        float year_pct = 0.0f;      // 年进度百分比

        int month = 1;              // 当前月份
        int day_of_month = 1;       // 当月第几天
        int days_in_month = 31;     // 当月天数
        float month_pct = 0.0f;     // 月进度百分比

        int weekday = 1;            // 周几 (1-7)
        int day_of_week = 1;        // 周内第几天
        float week_pct = 0.0f;      // 周进度百分比

        int age = 30;               // 当前年龄
        int life_expect = 80;       // 预期寿命
        float life_pct = 0.0f;      // 人生进度百分比

        std::string year_label;     // 年标签 "2026 年已过"
        std::string month_label;    // 月标签
        std::string week_label;     // 周标签
    };
    LifeBarState lifebar_state_;

    // 老黄历状态
    struct AlmanacState {
        int year = 2026;
        int month = 1;
        int day = 1;
        std::string lunar_date;        // 农历日期 (如 "正月初一")
        std::string month_cn;          // 农历月份 (如 "一月")
        std::string weekday_cn;        // 星期 (如 "周一")
        std::string solar_term;        // 节气 (如 "立春")
        std::string yi;                // 宜
        std::string ji;                // 忌
        std::string direction;         // 吉方
        std::string health_tip;        // 养生提示
        bool has_llm_data = false;     // 是否已获取 LLM 数据
    };
    AlmanacState almanac_state_;

    // 天气看板状态
    struct WeatherState {
        std::string city;              // 城市
        int today_temp = 0;            // 当前温度
        std::string today_desc;        // 天气描述
        int today_low = 0;             // 最低温度
        int today_high = 0;            // 最高温度
        int today_humidity = 0;        // 湿度
        std::string today_wind_dir;    // 风向
        int today_wind_level = 0;      // 风力
        std::string sunrise;           // 日出时间
        std::string sunset;            // 日落时间
        std::string advice;            // 穿衣建议
        // 预报数据（最多3天）
        struct ForecastDay {
            std::string weekday;
            std::string desc;
            int temp;
        };
        std::vector<ForecastDay> forecast;
        bool has_data = false;         // 是否已获取数据
    };
    WeatherState weather_state_;

    enum class PendingTodoOpType {
        Toggle,
        Delete
    };
    struct PendingTodoOp {
        PendingTodoOpType type = PendingTodoOpType::Toggle;
        std::string id;
        bool completed = false;
    };

    // Settings page state - 扁平化菜单设计
    // 网络管理: Wi-Fi状态, 服务状态
    // 系统控制: 音量调节, 重启设备, 关机
    static constexpr int kSettingsItemCount = 7;
    static constexpr int kSettingsItemWifi         = 0;   // Wi-Fi 控制
    static constexpr int kSettingsItemServer       = 1;   // 服务控制
    static constexpr int kSettingsItemVolume       = 2;   // 音量调节
    static constexpr int kSettingsItemBatteryPreview = 3; // 电池预览
    static constexpr int kSettingsItemBatteryStyle   = 4; // 电池方向
    static constexpr int kSettingsItemRestart      = 5;   // 重启设备
    static constexpr int kSettingsItemPowerOff     = 6;   // 关机
    int settings_selected_item_ = 0;
    bool settings_editing_volume_ = false;
    int battery_preview_level_ = 0;     // 电池预览等级 (0/20/50/80/100)
    bool battery_preview_active_ = false;  // 电池预览模式是否激活
    bool battery_vertical_ = false;       // 电池方向：false=横向, true=纵向
    int volume_ = 70;
    enum class NetworkState {
        Offline,
        Wifi,
        Server,
        Config
    };

    Phase phase_ = Phase::Idle;
    Page active_page_ = Page::Todo;
    VoiceMode voice_mode_ = VoiceMode::Todo;
    NetworkState network_state_ = NetworkState::Offline;
    std::string status_text_;
    std::string transcript_text_;
    std::string cli_status_text_;
    std::string cli_phase_text_;
    std::string latest_assistant_text_;
    // Conversation history for chat UI display (max 10 messages to save memory)
    std::vector<ChatMessage> chat_history_;
    static constexpr size_t kMaxChatHistorySize = 10;
    std::string repo_name_;
    std::string server_uri_;
    std::vector<std::string> cli_log_lines_;
    std::vector<TodoItem> todo_items_;
    std::vector<PendingTodoOp> pending_todo_ops_;
    int todo_selected_index_ = -1;
    std::string todo_last_action_text_;
    bool todo_menu_open_ = false;
    TodoMenuKind todo_menu_kind_ = TodoMenuKind::Todo;
    int todo_menu_selected_item_ = 0;
    bool offline_todo_mode_ = false;
    bool reconnect_stuck_prompt_ = false;
    bool pending_normal_after_reconnect_ = false;
    std::string hint_text_;
    int quota_5h_remaining_pct_ = -1;
    int quota_week_remaining_pct_ = -1;
    int battery_level_ = 0;
    bool battery_known_ = false;
    bool battery_charging_ = false;
    bool battery_discharging_ = false;
    int summary_scroll_offset_ = 0;
    int log_scroll_offset_ = 0;
    std::string cached_server_uri_;
    std::string paired_host_id_;
    std::string paired_host_name_;
    bool first_boot_ = true;

    bool Initialize();
    void LoadPersistedNetworkState();
    void SaveCachedServerUri(const std::string& server_uri);
    void SavePairedHost(const std::string& host_id, const std::string& host_name);
    void ClearPersistedHost();
    void RequestWifiReconfigureByReboot(const char* status_text, const char* hint_text);
    void ConfigureButtons();
    bool IsWifiConnected() const;
    bool IsServerConnected() const;
    bool EnsureWebSocketConnected();
    void StartConnectAttemptAsync();
    void RunConnectAttemptTask();
    bool DiscoverServerUri();
    std::string GetExpectedDiscoveryHostId() const;
    std::string GetFallbackServerUri() const;
    std::string GetDiscoveryHintText() const;
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
    bool SendSetMode(const char* mode);
    bool SendTodoCommand(const char* action, int index = 0, int completed = -1, const char* id = nullptr);
    VoiceMode DesiredVoiceModeForPage(Page page) const;
    bool SyncVoiceModeToPage(Page page);
    bool SyncVoiceModeToActivePage();
    Page PageForCurrentVoiceMode() const;
    bool StreamAudioFrame();
    void CapturePrerollFrame();
    bool FlushPrerollFrames();
    void HandleServerMessage(const char* data, size_t len);
    void HandleTtsAudio(const char* data, size_t len);
    void PlayTtsAudio(const int16_t* pcm_data, size_t samples);
    void RefreshBatteryStatus(bool force_update = false);
    void HandleScroll(int direction);
    void MoveTodoSelection(int direction);
    void ToggleSelectedTodo();
    void DeleteSelectedTodo();
    void OpenTodoMenu(TodoMenuKind kind = TodoMenuKind::Todo);
    void CloseTodoMenu();
    int GetTodoMenuItemCount() const;
    std::string GetTodoMenuItemLabel(int item) const;
    void HandleTodoMenuInput(bool up_click, bool down_click, bool boot_press);
    void ExecuteTodoMenuItem(int item);
    void EnterOfflineTodoMode(const std::string& message);
    void RequestReconnect(const std::string& message);
    void QueueOfflineTodoToggle(const TodoItem& item, bool completed);
    void QueueOfflineTodoDelete(const TodoItem& item);
    void FlushPendingTodoOps();
    void LoadCachedTodoState();
    // 倒计时功能
    void TryExtractTimerJson(const char* text);
    void StartCountdown(int duration_seconds, const std::string& label);
    void StopCountdown();
    void UpdateCountdown();
    void TriggerCountdownAlarm();
    void HandleCountdownInput(bool any_key);
    std::string FormatCountdownTime(int seconds) const;

    // 人生进度条功能
    void UpdateLifeBarState();
    void DrawLifeBarPage(std::vector<Display::TextItem>& texts);
    std::string FormatProgressBar(float pct, int width) const;

    // 老黄历功能
    void UpdateAlmanacState();
    void DrawAlmanacPage(std::vector<Display::TextItem>& texts);
    void RequestAlmanacLlmData();
    std::string GetLunarMonthName(int month) const;
    std::string GetLunarDayName(int day) const;
    std::string GetSolarTerm(int day_of_year) const;

    // 天气看板功能
    void UpdateWeatherState();
    void DrawWeatherPage(std::vector<Display::TextItem>& texts);
    void RequestWeatherData();

    void SaveCachedTodoState();
    void LoadPendingTodoOps();
    void SavePendingTodoOps();
    void SwitchPage(Page page);
    void EnterSettings();
    void HandleSettingsInput(bool up_click, bool down_click, bool boot_press);
    void ExecuteSettingsItem(int item);
    void Shutdown();
    void SaveVolume();
    void SaveBatteryStyle();
    const char* GetNetworkLabel() const;
    std::string GetPhaseLabel() const;
    const char* GetModeLabel() const;
    const char* GetToolLabel() const;  // "Claude" | "Codex" | "Inject"
    std::string GetFooterText() const;
    std::string BuildPromptBody() const;
    std::string BuildReplyBody() const;
    bool ShouldShowIdleTodoPage() const;
    void ShowIdleTodoPage();
    std::vector<std::string> WrapText(const std::string& text, size_t max_chars) const;
    std::vector<std::string> SliceLines(const std::vector<std::string>& lines, int offset, size_t max_lines) const;
    void UpdateLed();
    void PlayBeep(int freq_hz, int duration_ms);
    void DrawHorizontalLine(int y, int thickness = 1);
    void DrawWifiIcon(int x, int y);
    void DrawBatteryIcon(int x, int y, int level, bool charging, bool vertical = false);
    // 绘制真正的气泡边框（符合 Spec §3）
    void DrawBubble(int x, int y, int w, int h, bool filled, int radius = 4);
    void UpdateDisplay();
};

#endif // LAN_MIC_APP_H
