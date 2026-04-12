#ifndef ALMANAC_PAGE_H
#define ALMANAC_PAGE_H

#include <lvgl.h>
#include <string>

namespace ui {

// 老黄历数据
struct AlmanacData {
    std::string date;          // 日期
    std::string lunar_date;    // 农历日期
    std::string suit;          // 宜
    std::string avoid;         // 忌
    std::string auspicious;    // 吉时
};

// 老黄历页 - 简化布局
class AlmanacPage {
public:
    AlmanacPage(lv_obj_t* parent);
    ~AlmanacPage();

    // 更新数据
    void UpdateData(const AlmanacData& data);

    // 刷新显示
    void Refresh();

private:
    lv_obj_t* container_ = nullptr;
    lv_obj_t* date_label_ = nullptr;
    lv_obj_t* lunar_label_ = nullptr;
    lv_obj_t* suit_label_ = nullptr;
    lv_obj_t* avoid_label_ = nullptr;
    lv_obj_t* auspicious_label_ = nullptr;
};

}  // namespace ui

#endif  // ALMANAC_PAGE_H