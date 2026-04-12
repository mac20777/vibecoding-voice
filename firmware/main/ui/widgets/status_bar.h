#ifndef STATUS_BAR_H
#define STATUS_BAR_H

#include <lvgl.h>
#include <string>

namespace ui {

// 状态栏数据
struct StatusBarData {
    std::string page_title;     // 页面标题
    bool wifi_connected;        // WiFi 是否连接
    bool server_connected;      // 服务是否连接
    int battery_level;          // 电池电量 (0-100)
    bool battery_charging;      // 是否充电
};

// 状态栏组件 - 顶部固定区域
class StatusBar {
public:
    StatusBar(lv_obj_t* parent);
    ~StatusBar();

    // 更新状态栏数据
    void Update(const StatusBarData& data);

    // 刷新显示
    void Refresh();

    // 获取高度
    static constexpr int GetHeight() { return 32; }

private:
    lv_obj_t* container_ = nullptr;
    lv_obj_t* wifi_icon_ = nullptr;
    lv_obj_t* status_text_ = nullptr;
    lv_obj_t* title_label_ = nullptr;
    lv_obj_t* battery_label_ = nullptr;

    // 绘制横向 3 节电池图标
    void DrawBattery3Cell(lv_obj_t* canvas, int level, bool charging);
};

}  // namespace ui

#endif  // STATUS_BAR_H