#include <esp_log.h>
#include <esp_err.h>
#include <nvs.h>
#include <nvs_flash.h>
#include <driver/gpio.h>
#include <esp_event.h>
#include <esp_sleep.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "application.h"
#include "lan_mic_app.h"
#include "system_info.h"

#define TAG "main"

// Persists across soft resets and deep sleep, cleared only on power-on.
// Used to avoid bouncing more than once per software reset.
static RTC_DATA_ATTR bool s_sw_reset_bounced = false;

static void LogNvsStats() {
    nvs_stats_t stats = {};
    esp_err_t ret = nvs_get_stats(nullptr, &stats);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "NVS stats read failed: %s", esp_err_to_name(ret));
        return;
    }
    uint32_t used = stats.used_entries;
    uint32_t total = stats.total_entries;
    uint32_t free_entries = stats.free_entries;
    uint32_t percent = (total > 0) ? (used * 100U / total) : 0;
    ESP_LOGI(TAG, "NVS stats: used=%u free=%u total=%u (%u%%) namespaces=%u",
             used, free_entries, total, percent, stats.namespace_count);
}

extern "C" void app_main(void)
{
    // After esptool flashes via USB-CDC, it issues a software reset (RTS line)
    // which does not fully reinitialize the Wi-Fi RF peripheral, causing
    // connection failures until a physical RST press.  We detect this by
    // checking the reset reason: on ESP_RST_SW, do a 100 ms deep-sleep round-
    // trip which produces a hardware-equivalent wakeup reset — clean for Wi-Fi.
    // The RTC flag prevents an infinite bounce loop.
    {
        const auto reason = esp_reset_reason();
        ESP_LOGI(TAG, "Boot reset reason=%d bounced=%d", reason, s_sw_reset_bounced ? 1 : 0);
        // Deep-sleep wakeup produces a hardware-equivalent reset that properly
        // reinitialises the Wi-Fi RF peripheral.  For every other reset type
        // except power-on we do a brief deep-sleep round-trip to guarantee a
        // clean RF state — this covers both esptool hard_reset (ESP_RST_EXT)
        // and software reset (ESP_RST_SW).  The RTC flag prevents looping.
        const bool need_bounce = !s_sw_reset_bounced &&
                                 reason != ESP_RST_POWERON &&
                                 reason != ESP_RST_DEEPSLEEP &&
                                 reason != ESP_RST_BROWNOUT;
        if (need_bounce) {
            ESP_LOGI(TAG, "Reset reason %d — bouncing via deep sleep for clean Wi-Fi init", reason);
            s_sw_reset_bounced = true;
            esp_sleep_enable_timer_wakeup(500000ULL);  // 500 ms
            esp_deep_sleep_start();
        }
        s_sw_reset_bounced = false;
    }  // clear for next time

    // Initialize NVS flash for WiFi configuration
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "Erasing NVS flash to fix corruption");
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    LogNvsStats();

#if CONFIG_ZECTRIX_LAN_MIC_MODE
    LanMicApp app;
    app.Run();
#else
    auto& app = Application::GetInstance();
    app.Initialize();
    app.Run();  // This function runs the main event loop and never returns
#endif
}
