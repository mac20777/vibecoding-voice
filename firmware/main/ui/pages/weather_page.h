#ifndef WEATHER_PAGE_H
#define WEATHER_PAGE_H

#include <lvgl.h>
#include <string>

namespace ui {

// 天气数据结构
struct WeatherData {
    std::string city;           // 城市
    std::string temp;           // 温度
    std::string condition;      // 天气状况
    std::string humidity;       // 湿度
    std::string wind;           // 风速风向
    std::string update_time;    // 更新时间
};

// 天气看板页 - Grid 布局
class WeatherPage {
public:
    WeatherPage(lv_obj_t* parent);
    ~WeatherPage();

    // 更新天气数据
    void UpdateWeather(const WeatherData& data);

    // 刷新显示
    void Refresh();

private:
    lv_obj_t* container_ = nullptr;   // Grid 容器
    lv_obj_t* city_label_ = nullptr;
    lv_obj_t* temp_label_ = nullptr;
    lv_obj_t* condition_label_ = nullptr;
    lv_obj_t* humidity_label_ = nullptr;
    lv_obj_t* wind_label_ = nullptr;
    lv_obj_t* time_label_ = nullptr;

    // 初始化 Grid 布局
    void SetupGrid();
};

}  // namespace ui

#endif  // WEATHER_PAGE_H