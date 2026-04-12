#ifndef LOG_PAGE_H
#define LOG_PAGE_H

#include <lvgl.h>
#include <string>
#include <vector>

namespace ui {

// 日志条目
struct LogEntry {
    std::string text;
    int level = 0;  // 0=info, 1=warn, 2=error
};

// 日志页面 - 系统日志查看
class LogPage {
public:
    LogPage(lv_obj_t* parent);
    ~LogPage();

    // 清空日志
    void Clear();

    // 添加日志条目
    void AddEntry(const std::string& text, int level = 0);

    // 设置日志列表
    void SetEntries(const std::vector<LogEntry>& entries);

    // 刷新显示
    void Refresh();

private:
    lv_obj_t* container_ = nullptr;     // 容器
    lv_obj_t* log_label_ = nullptr;     // 日志文本标签
    std::vector<std::string> entries_;  // 日志内容
};

}  // namespace ui

#endif  // LOG_PAGE_H