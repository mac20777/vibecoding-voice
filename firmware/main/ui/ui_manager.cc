#include "ui_manager.h"
#include <esp_log.h>

namespace ui {

constexpr char kTag[] = "UiManager";

UiManager::UiManager() {}

UiManager::~UiManager() {
    if (tabview_) {
        lv_obj_delete(tabview_);
    }
}

void UiManager::Init(lv_display_t* display) {
    display_ = display;

    // Set this display as default so lv_screen_active() works
    lv_display_set_default(display);

    // 创建主屏幕
    lv_obj_t* scr = lv_screen_active();

    // 创建状态栏（固定在顶部）
    status_bar_ = std::make_unique<StatusBar>(scr);

    // 创建 TabView 容器（在状态栏下方）
    tabview_ = lv_tabview_create(scr);
    lv_tabview_set_tab_bar_position(tabview_, LV_DIR_NONE);  // 隐藏 Tab 按钮，用物理按键切换
    lv_obj_set_size(tabview_, LV_PCT(100), 300 - StatusBar::GetHeight());
    lv_obj_set_pos(tabview_, 0, StatusBar::GetHeight());

    // 创建各个页面
    CreatePages();

    // 初始化状态栏显示当前页面标题
    StatusBarData init_data;
    init_data.page_title = "对话";
    init_data.wifi_connected = false;
    init_data.server_connected = false;
    init_data.battery_level = -1;
    init_data.battery_charging = false;
    UpdateStatusBar(init_data);

    ESP_LOGI(kTag, "UI Manager initialized with status bar and 7 pages");
}

void UiManager::CreatePages() {
    // 7 个页面（按 spec_v2 顺序）
    const char* page_names[] = {
        "Chat",    // 0 - 对话
        "Todo",    // 1 - Todo
        "Log",     // 2 - 日志
        "LifeBar", // 3 - 人生进度
        "Almanac", // 4 - 老黄历
        "Weather", // 5 - 天气
        "Settings" // 6 - 设置
    };

    for (int i = 0; i < 7; ++i) {
        tabs_[i] = lv_tabview_add_tab(tabview_, page_names[i]);
        lv_obj_set_style_bg_color(tabs_[i], lv_color_white(), 0);
    }

    // 创建页面实例
    chat_page_ = std::make_unique<ChatPage>(tabs_[0]);
    todo_page_ = std::make_unique<TodoPage>(tabs_[1]);
    log_page_ = std::make_unique<LogPage>(tabs_[2]);
    lifebar_page_ = std::make_unique<LifeBarPage>(tabs_[3]);
    almanac_page_ = std::make_unique<AlmanacPage>(tabs_[4]);
    weather_page_ = std::make_unique<WeatherPage>(tabs_[5]);
    settings_page_ = std::make_unique<SettingsPage>(tabs_[6]);
}

void UiManager::SwitchPage(PageId page) {
    if (!tabview_) return;

    int index = static_cast<int>(page);

    // 【Spec v3 §5】清屏机制：切换页面前先清除内容区域，防止残影
    // 保留状态栏（Y: 0-30），清除内容区（Y: 30-300）
    ClearContentArea();

    // 切换到新页面
    lv_tabview_set_active(tabview_, index, LV_ANIM_OFF);
    current_page_ = page;

    // 更新状态栏中的页面标题
    const char* titles[] = {
        "对话",     // 0
        "Todo",     // 1
        "日志",     // 2
        "人生进度", // 3
        "老黄历",   // 4
        "天气",     // 5
        "设置"      // 6
    };
    StatusBarData data;
    data.page_title = titles[index];
    UpdateStatusBar(data);

    // 墨水屏：立即刷新显示切换
    RefreshNow();

    // 强制全局刷新清除残影（spec_v2 §5）
    RequestFullRefresh();

    ESP_LOGI(kTag, "Switched to page %d (%s)", index, titles[index]);
}

void UiManager::ClearContentArea() {
    // 清除内容区域（保留顶部状态栏）
    // 使用 LVGL 的 invalidate + fill 方式清除
    lv_obj_t* scr = lv_screen_active();
    if (!scr) return;

    // 在 TabView 区域绘制白色矩形来清除内容
    // TabView 位置：Y 从 StatusBar::GetHeight() (30) 开始
    int content_y = StatusBar::GetHeight();
    int content_height = 300 - content_y;

    // 创建一个临时白色覆盖层清除内容
    lv_obj_t* clear_layer = lv_obj_create(scr);
    lv_obj_set_pos(clear_layer, 0, content_y);
    lv_obj_set_size(clear_layer, 400, content_height);
    lv_obj_set_style_bg_color(clear_layer, lv_color_white(), 0);
    lv_obj_set_style_bg_opa(clear_layer, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(clear_layer, 0, 0);
    lv_obj_set_style_radius(clear_layer, 0, 0);

    // 立即刷新这个清除层
    lv_refr_now(display_);

    // 删除清除层
    lv_obj_delete(clear_layer);

    ESP_LOGI(kTag, "Content area cleared (Y: %d-%d)", content_y, content_y + content_height);
}

lv_obj_t* UiManager::GetPage(PageId page) const {
    int index = static_cast<int>(page);
    if (index >= 0 && index < 7) {
        return tabs_[index];
    }
    return nullptr;
}

void UiManager::RefreshNow() {
    if (!display_) return;

    // LVGL 静态刷新：强制立即渲染
    lv_refr_now(display_);

    refresh_count_++;

    // 每 10 次部分刷新后，触发一次全局刷新清除残影
    if (refresh_count_ >= 10) {
        full_refresh_pending_ = true;
        refresh_count_ = 0;
    }
}

void UiManager::RequestFullRefresh() {
    full_refresh_pending_ = true;
}

void UiManager::UpdateStatusBar(const StatusBarData& data) {
    if (status_bar_) {
        status_bar_->Update(data);
    }
}

}  // namespace ui