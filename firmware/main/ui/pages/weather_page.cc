#include "weather_page.h"
#include <esp_log.h>

// 外部字体声明（支持中文）
extern const lv_font_t SourceHanSansSC_Regular_slim;
extern const lv_font_t weather_icons_48;

namespace ui {

constexpr char kTag[] = "WeatherPage";

WeatherPage::WeatherPage(lv_obj_t* parent) {
    // 创建 Grid 容器
    container_ = lv_obj_create(parent);
    lv_obj_set_size(container_, LV_PCT(100), LV_PCT(100));
    lv_obj_set_style_bg_color(container_, lv_color_white(), 0);
    lv_obj_set_style_pad_all(container_, 8, 0);

    SetupGrid();

    ESP_LOGI(kTag, "Weather page created with Grid layout");
}

WeatherPage::~WeatherPage() {
    // 子控件会随 container 删除而删除
}

void WeatherPage::SetupGrid() {
    // Grid 布局：4 列 3 行
    static lv_coord_t col_dsc[] = {LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_TEMPLATE_LAST};
    static lv_coord_t row_dsc[] = {LV_GRID_CONTENT, LV_GRID_CONTENT, LV_GRID_CONTENT, LV_GRID_TEMPLATE_LAST};

    lv_obj_set_grid_dsc_array(container_, col_dsc, row_dsc);

    // 城市名（第 0 行，占 4 列）
    city_label_ = lv_label_create(container_);
    lv_label_set_text(city_label_, "北京");
    lv_obj_set_grid_cell(city_label_, LV_GRID_ALIGN_CENTER, 0, 4, LV_GRID_ALIGN_CENTER, 0, 1);

    // 温度（第 1 行，占 2 列）
    temp_label_ = lv_label_create(container_);
    lv_label_set_text(temp_label_, "25°C");
    lv_obj_set_grid_cell(temp_label_, LV_GRID_ALIGN_START, 0, 2, LV_GRID_ALIGN_CENTER, 1, 1);

    // 天气状况（第 1 行，占 2 列）
    condition_label_ = lv_label_create(container_);
    lv_label_set_text(condition_label_, "晴");
    lv_obj_set_grid_cell(condition_label_, LV_GRID_ALIGN_END, 2, 2, LV_GRID_ALIGN_CENTER, 1, 1);

    // 湿度（第 2 行，占 2 列）
    humidity_label_ = lv_label_create(container_);
    lv_label_set_text(humidity_label_, "湿度: 45%");
    lv_obj_set_grid_cell(humidity_label_, LV_GRID_ALIGN_START, 0, 2, LV_GRID_ALIGN_CENTER, 2, 1);

    // 风速（第 2 行，占 2 列）
    wind_label_ = lv_label_create(container_);
    lv_label_set_text(wind_label_, "风速: 3m/s");
    lv_obj_set_grid_cell(wind_label_, LV_GRID_ALIGN_END, 2, 2, LV_GRID_ALIGN_CENTER, 2, 1);

    // 更新时间（底部）
    time_label_ = lv_label_create(container_);
    lv_label_set_text(time_label_, "更新时间: --:--");
    lv_obj_set_grid_cell(time_label_, LV_GRID_ALIGN_CENTER, 0, 4, LV_GRID_ALIGN_END, 2, 1);
}

void WeatherPage::UpdateWeather(const WeatherData& data) {
    if (city_label_) lv_label_set_text(city_label_, data.city.c_str());
    if (temp_label_) lv_label_set_text(temp_label_, data.temp.c_str());
    if (condition_label_) lv_label_set_text(condition_label_, data.condition.c_str());
    if (humidity_label_) lv_label_set_text(humidity_label_, data.humidity.c_str());
    if (wind_label_) lv_label_set_text(wind_label_, data.wind.c_str());
    if (time_label_) lv_label_set_text(time_label_, data.update_time.c_str());
}

void WeatherPage::Refresh() {
    // LVGL 会自动处理刷新
}

}  // namespace ui