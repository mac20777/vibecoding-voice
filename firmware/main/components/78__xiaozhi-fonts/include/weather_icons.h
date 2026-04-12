#pragma once

#include <stdint.h>
#include <lvgl.h>

#ifdef __cplusplus
extern "C" {
#endif

// Weather icons extracted from FontAwesome (fontawesome-webfont.ttf)
// Generated with lv_font_conv --bpp 1 --no-compress
// Source: https://fontawesome.com/v4/icons/

// 16px weather icons
LV_FONT_DECLARE(weather_icons_16);
extern const lv_font_t weather_icons_16;

// 48px weather icons
LV_FONT_DECLARE(weather_icons_48);
extern const lv_font_t weather_icons_48;

// Unicode constants for weather icons (FontAwesome codes)
#define FA_WEATHER_CLOUD      "\xef\x83\x82"  // U+F0C2 ☁️ Cloud
#define FA_WEATHER_THUNDER    "\xef\x83\x83"  // U+F0C3 ⛈️ Cloud with lightning
#define FA_WEATHER_RAIN       "\xef\x83\xa9"  // U+F0E9 ☂️ Umbrella (rain)
#define FA_WEATHER_SUN        "\xef\x86\x85"  // U+F185 ☀️ Sun
#define FA_WEATHER_SNOW       "\xef\x8b\x9c"  // U+F2DC ❄️ Snowflake-o

#ifdef __cplusplus
}
#endif
