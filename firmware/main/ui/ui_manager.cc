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

    // 创建主屏幕
    lv_obj_t* scr = lv_screen_active();

    // 创建状态栏（固定在顶部，高度 32px）
    status_bar_ = std::make_unique<StatusBar>(scr);

    // 创建 TabView 容器（在状态栏下方，高度 = 300 - 32 = 268）
    tabview_ = lv_tabview_create(scr);
    lv_tabview_set_tab_bar_position(tabview_, LV_DIR_NONE);  // 隐藏 Tab 按钮，用物理按键切换
    lv_obj_set_size(tabview_, LV_PCT(100), 268);  // 高度减去状态栏
    lv_obj_set_pos(tabview_, 0, StatusBar::GetHeight());  // Y 从状态栏下方开始

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

    ESP_LOGI(kTag, "UI Manager initialized with status bar and 5 pages");
}

void UiManager::CreatePages() {
    // 页面名称（用于内部标识）
    const char* page_names[] = {"Chat", "Weather", "LifeBar", "Almanac", "Settings"};

    for (int i = 0; i < 5; ++i) {
        tabs_[i] = lv_tabview_add_tab(tabview_, page_names[i]);
        lv_obj_set_style_bg_color(tabs_[i], lv_color_white(), 0);
    }

    // 创建页面实例
    chat_page_ = std::make_unique<ChatPage>(tabs_[0]);
    weather_page_ = std::make_unique<WeatherPage>(tabs_[1]);
    lifebar_page_ = std::make_unique<LifeBarPage>(tabs_[2]);
    almanac_page_ = std::make_unique<AlmanacPage>(tabs_[3]);
    settings_page_ = std::make_unique<SettingsPage>(tabs_[4]);
}

void UiManager::SwitchPage(PageId page) {
    if (!tabview_) return;

    int index = static_cast<int>(page);
    lv_tabview_set_active(tabview_, index, LV_ANIM_OFF);
    current_page_ = page;

    // 更新状态栏中的页面标题
    const char* titles[] = {"对话", "天气", "人生进度", "老黄历", "设置"};
    StatusBarData data;
    data.page_title = titles[index];
    UpdateStatusBar(data);

    // 墨水屏：立即刷新显示切换
    RefreshNow();

    ESP_LOGI(kTag, "Switched to page %d (%s)", index, titles[index]);
}

lv_obj_t* UiManager::GetPage(PageId page) const {
    int index = static_cast<int>(page);
    if (index >= 0 && index < 5) {
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