#pragma once

#include <stdint.h>
#include <lvgl.h>

#ifdef __cplusplus
extern "C" {
#endif

// From docs/zectrix_fonts/demo.html (IcoMoon)

// Battery icons (icon-b*)
#define FONT_ZECTRIX_BATTERY_EMPTY "\xee\xa4\x85"      // icon-b1 (e905)
#define FONT_ZECTRIX_BATTERY_25     "\xee\xa4\x82"         // icon-b25 (e902)
#define FONT_ZECTRIX_BATTERY_50     "\xee\xa4\x83"         // icon-b50 (e903)
#define FONT_ZECTRIX_BATTERY_75     "\xee\xa4\x84"         // icon-b75 (e904)
#define FONT_ZECTRIX_BATTERY_FULL   "\xee\xa4\x81"       // icon-b2 (e901)
#define FONT_ZECTRIX_BATTERY_CHARGING "\xee\xa4\x8c"     // icon-charging (e90c)

// Wi-Fi icons (icon-Wi-Fi-*)
#define FONT_ZECTRIX_WIFI_FULL "\xee\xa4\x8e"             // icon-Wi-Fi-1 (e90e)
#define FONT_ZECTRIX_WIFI_FAIR "\xee\xa4\x8f"             // icon-Wi-Fi-2 (e90f)
#define FONT_ZECTRIX_WIFI_WEAK "\xee\xa4\x90"             // icon-Wi-Fi-3 (e910)
#define FONT_ZECTRIX_WIFI_SLASH "\xee\xa4\x86"            // icon-w3 (e906)


// Status / UI icons
#define FONT_ZECTRIX_ICON_MUTE "\xee\xa4\x8b"          // icon-mute (e90b)
#define FONT_ZECTRIX_ICON_SPEAKER "\xee\xa4\x89"          // icon-speaker (e909)
#define FONT_ZECTRIX_ICON_CHECKBOX "\xee\xa4\x91"      // icon-checkbox (e911)
#define FONT_ZECTRIX_ICON_CHECKBOX_OK "\xee\xa4\x8a"   // icon-checkboxok (e90a)
#define FONT_ZECTRIX_ICON_MIC "\xee\xa4\x80"           // icon-mic (e900)
#define FONT_ZECTRIX_ICON_SETTING "\xee\xa4\x8d"       // icon-setting (e90d)
#define FONT_ZECTRIX_ICON_POWER "\xee\xa4\x92"         // icon-power (e912)
#define FONT_ZECTRIX_ICON_SYNC "\xee\xa4\x93"          // icon-sync (e913)
#define FONT_ZECTRIX_ICON_REBOOT "\xee\xa4\x94"        // icon-reboot (e914)

#define FONT_ZECTRIX_ICON_TODO "\xee\xa4\x87"             // icon-todo (e907)

// Unclassified (kept by icon name)
#define FONT_ZECTRIX_ICON_COLON "\xee\xa4\x95"           // icon-mao (e915)
#define FONT_ZECTRIX_ICON_0 "\xee\xa4\x9f"          // icon-0
#define FONT_ZECTRIX_ICON_1 "\xee\xa4\x88"             // icon-1 (e908)
#define FONT_ZECTRIX_ICON_2 "\xee\xa4\x97"             // icon-2 (e917)
#define FONT_ZECTRIX_ICON_3 "\xee\xa4\x98"             // icon-3 (e918)
#define FONT_ZECTRIX_ICON_4 "\xee\xa4\x9e"            // icon-4 (e91e)
#define FONT_ZECTRIX_ICON_5 "\xee\xa4\x99"             // icon-5 (e919)
#define FONT_ZECTRIX_ICON_6 "\xee\xa4\x9a"             // icon-6 (e91a)
#define FONT_ZECTRIX_ICON_7 "\xee\xa4\x9b"             // icon-7 (e91b)
#define FONT_ZECTRIX_ICON_8 "\xee\xa4\x9c"             // icon-8 (e91c)
#define FONT_ZECTRIX_ICON_9 "\xee\xa4\x9d"             // icon-9 (e91d)

// Weather icons (FontAwesome PUA 编码) - 已生成字体文件
// 来源: fontawesome-webfont.ttf (Private Use Area U+F0XX)
// UTF-8 编码: 0xEF 0x8X 0xXX (3字节)
#define FONT_ZECTRIX_WEATHER_SUN     "\xef\x86\x85"    // U+F185 ☀️ 太阳 - 晴天
#define FONT_ZECTRIX_WEATHER_CLOUD   "\xef\x83\x82"    // U+F0C2 ☁️ 云朵 - 多云
#define FONT_ZECTRIX_WEATHER_RAIN    "\xef\x83\xa9"    // U+F0E9 🌧️ 下雨 - 雨天
#define FONT_ZECTRIX_WEATHER_SNOW    "\xef\x8b\x9c"    // U+F2DC ❄️ 雪花 - 雪天
#define FONT_ZECTRIX_WEATHER_THUNDER "\xef\x83\x83"    // U+F0C3 🌩️ 雷暴 - 雷电

// 天气详情图标 (使用已有图标或新定义)
#define FONT_ZECTRIX_WEATHER_WIND    "\xef\x83\xa7"    // U+F0E7 💨 风 (FontAwesome)
#define FONT_ZECTRIX_WEATHER_TEMP    "\xee\xa4\xa8"    // 温度计 (保持原有定义)
#define FONT_ZECTRIX_WEATHER_HUMIDITY "\xee\xa4\xa9"   // 水滴 (保持原有定义)
#define FONT_ZECTRIX_WEATHER_SUNRISE "\xee\xa4\xaa"    // 日出 (保持原有定义)
#define FONT_ZECTRIX_WEATHER_SUNSET  "\xee\xa4\xab"    // 日落 (保持原有定义)
#define FONT_ZECTRIX_WEATHER_LOCATION "\xee\xa4\xac"   // 位置 (保持原有定义)


#ifdef __cplusplus
}
#endif
