#ifndef UI_MANAGER_H
#define UI_MANAGER_H

#include <lvgl.h>
#include <functional>
#include <string>
#include <memory>

#include "pages/chat_page.h"
#include "pages/todo_page.h"
#include "pages/log_page.h"
#include "pages/weather_page.h"
#include "pages/lifebar_page.h"
#include "pages/almanac_page.h"
#include "pages/settings_page.h"
#include "widgets/status_bar.h"

namespace ui {

// 页面索引（7个页面，按 spec_v2 顺序）
enum class PageId {
    Chat = 0,      // AI 对话
    Todo = 1,      // Todo 任务列表
    Log = 2,       // 系统日志
    LifeBar = 3,   // 人生进度
    Almanac = 4,   // 老黄历
    Weather = 5,   // 天气看板
    Settings = 6,  // 设置
};

// UI 管理器 - TabView 容器 + 状态栏
class UiManager {
public:
    UiManager();
    ~UiManager();

    // 初始化 UI 框架（传入 LVGL display）
    void Init(lv_display_t* display);

    // 切换页面
    void SwitchPage(PageId page);

    // 获取当前页面
    PageId GetCurrentPage() const { return current_page_; }

    // 刷新当前页面（静态刷新，用于墨水屏）
    void RefreshNow();

    // 触发全局刷新（清除残影）
    void RequestFullRefresh();

    // 清除内容区域（保留状态栏，spec_v3 §5）
    void ClearContentArea();

    // 更新状态栏
    void UpdateStatusBar(const StatusBarData& data);

    // 页面对象访问
    lv_obj_t* GetTabView() const { return tabview_; }
    lv_obj_t* GetPage(PageId page) const;

    // 页面实例访问
    ChatPage* GetChatPage() { return chat_page_.get(); }
    TodoPage* GetTodoPage() { return todo_page_.get(); }
    LogPage* GetLogPage() { return log_page_.get(); }
    WeatherPage* GetWeatherPage() { return weather_page_.get(); }
    LifeBarPage* GetLifeBarPage() { return lifebar_page_.get(); }
    AlmanacPage* GetAlmanacPage() { return almanac_page_.get(); }
    SettingsPage* GetSettingsPage() { return settings_page_.get(); }

private:
    lv_display_t* display_ = nullptr;
    lv_obj_t* tabview_ = nullptr;
    lv_obj_t* tabs_[7] = {nullptr};  // 7 个页面对象
    PageId current_page_ = PageId::Chat;
    int refresh_count_ = 0;
    bool full_refresh_pending_ = false;

    // 状态栏（固定在顶部）
    std::unique_ptr<StatusBar> status_bar_;

    // 页面实例
    std::unique_ptr<ChatPage> chat_page_;
    std::unique_ptr<TodoPage> todo_page_;
    std::unique_ptr<LogPage> log_page_;
    std::unique_ptr<WeatherPage> weather_page_;
    std::unique_ptr<LifeBarPage> lifebar_page_;
    std::unique_ptr<AlmanacPage> almanac_page_;
    std::unique_ptr<SettingsPage> settings_page_;

    void CreatePages();
};

}  // namespace ui

#endif  // UI_MANAGER_H