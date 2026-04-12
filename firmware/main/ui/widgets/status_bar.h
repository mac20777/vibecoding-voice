#pragma once

#include <lvgl.h>
#include <string>

namespace ui {

struct StatusBarData {
    std::string page_title;
    bool wifi_connected = false;
    bool server_connected = false;
    int battery_level = -1;
    bool battery_charging = false;
};

class StatusBar {
public:
    static constexpr int kHeight = 30;
    static constexpr int GetHeight() { return kHeight; }

    StatusBar(lv_obj_t* parent);
    void Update(const StatusBarData& data);

private:
    void DrawBatteryIcon(int level, bool charging);  // 绘制 3 节电池

    lv_obj_t* container_ = nullptr;
    lv_obj_t* wifi_icon_ = nullptr;      // WiFi 图标（实心/叉号）
    lv_obj_t* status_text_ = nullptr;    // 服务状态文字（Online/No Srv）
    lv_obj_t* title_label_ = nullptr;    // 页面标题（居中）
    lv_obj_t* battery_canvas_ = nullptr; // 电池图标 Canvas (3 节横向电池)
    lv_obj_t* battery_label_ = nullptr;  // 电池百分比（Canvas 右侧）
};

}  // namespace ui