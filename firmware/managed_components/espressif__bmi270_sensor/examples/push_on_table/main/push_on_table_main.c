/*
 * SPDX-FileCopyrightText: 2025 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file push_on_table_main.c
 * @brief BMI270 push-on-table detection example for ESP32
 *
 * This example demonstrates how to initialize the BMI270 sensor, configure it for
 * push-on-table detection, and handle interrupts using ESP32 GPIO. The code includes
 * I2C initialization, sensor configuration, interrupt service routines, and main
 * application logic.
 */

#include <stdio.h>
#include <stdbool.h>
#include "esp_system.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "bmi270_api.h"

// Configure GPIO pins based on selected development board
#ifdef CONFIG_BOARD_ESP_SPOT_C5
#define I2C_INT_IO              3       /*!< Interrupt pin */
#define I2C_MASTER_SCL_IO       26      /*!< I2C SCL pin */
#define I2C_MASTER_SDA_IO       25      /*!< I2C SDA pin */
#define UE_SW_I2C               1       /*!< Use software I2C */
#elif defined(CONFIG_BOARD_ESP_SPOT_S3)
#define I2C_INT_IO              5
#define I2C_MASTER_SCL_IO       1
#define I2C_MASTER_SDA_IO       2
#define UE_SW_I2C               1
#elif defined(CONFIG_BOARD_ESP_ASTOM_S3)
#define I2C_INT_IO              16
#define I2C_MASTER_SCL_IO       0
#define I2C_MASTER_SDA_IO       45
#define UE_SW_I2C               1
#elif defined(CONFIG_BOARD_ESP_ECHOEAR_S3)
#define I2C_INT_IO              21
#define I2C_MASTER_SCL_IO       1
#define I2C_MASTER_SDA_IO       2
#define UE_SW_I2C               0
#else
#define I2C_INT_IO              CONFIG_I2C_INT_IO
#define I2C_MASTER_SCL_IO       CONFIG_I2C_MASTER_SCL_IO
#define I2C_MASTER_SDA_IO       CONFIG_I2C_MASTER_SDA_IO
#define UE_SW_I2C               CONFIG_UE_SW_I2C
#endif

#define I2C_MASTER_NUM          I2C_NUM_0
#define I2C_MASTER_FREQ_HZ      (100 * 1000)

static bmi270_handle_t bmi_handle = NULL;
static i2c_bus_handle_t i2c_bus;
static volatile bool interrupt_status = false;

/**
 * @brief GPIO interrupt service routine for BMI270 INT pin
 *
 * This ISR sets the interrupt_status flag when an interrupt is detected on the configured GPIO.
 *
 * @param[in] arg GPIO number (cast from void*)
 */
static void IRAM_ATTR gpio_isr_edge_handler(void* arg)
{
    uint32_t gpio_num = (uint32_t) arg;
    interrupt_status = true;
    esp_rom_printf("GPIO[%"PRIu32"] intr, val: %d\n", gpio_num, gpio_get_level(gpio_num));
}

/**
 * @brief Initialize I2C bus and BMI270 sensor
 *
 * This function configures the I2C bus and creates the BMI270 sensor handle with Toy firmware.
 *
 * @return
 *      - ESP_OK: Success
 *      - ESP_FAIL: Initialization failed
 */
static esp_err_t i2c_sensor_bmi270_toy_init(void)
{
    const i2c_config_t i2c_bus_conf = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = I2C_MASTER_SDA_IO,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_io_num = I2C_MASTER_SCL_IO,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = I2C_MASTER_FREQ_HZ
    };
#if UE_SW_I2C
    i2c_bus = i2c_bus_create(I2C_NUM_SW_1, &i2c_bus_conf);
#else
    i2c_bus = i2c_bus_create(I2C_MASTER_NUM, &i2c_bus_conf);
#endif
    if (!i2c_bus) {
        ESP_LOGE("MAIN", "I2C bus create failed");
        return ESP_FAIL;
    }

    esp_err_t ret = bmi270_sensor_create(i2c_bus, &bmi_handle, bmi270_toy_config_file, 0);
    if (ret != ESP_OK || bmi_handle == NULL) {
        ESP_LOGE("MAIN", "BMI270 TOY create failed");
        return ESP_FAIL;
    }

    return ESP_OK;
}

/**
 * @brief Configure accelerometer and gyroscope parameters
 *
 * This function sets the sampling rate, range, filter parameters for accelerometer
 * and gyroscope, and configures the INT1 pin for interrupt output.
 *
 * @param[in] bmi2_dev Pointer to BMI2 device structure
 *
 * @return BMI2 API execution status
 *      - BMI2_OK: Success
 *      - Other values: Failure
 */
static int8_t set_accel_gyro_config(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    struct bmi2_sens_config config[2];
    struct bmi2_int_pin_config pin_config = { 0 };

    config[BMI2_ACCEL].type = BMI2_ACCEL;
    config[BMI2_GYRO].type = BMI2_GYRO;

    rslt = bmi2_get_int_pin_config(&pin_config, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    rslt = bmi2_get_sensor_config(config, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* Configure accelerometer output data rate */
        config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_200HZ;        /* 200Hz sampling rate */
        config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_16G;      /* ±16G range */
        config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;      /* Standard averaging */
        config[BMI2_ACCEL].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE; /* Filter performance */

        /* Configure gyroscope output data rate */
        config[BMI2_GYRO].cfg.gyr.odr = BMI2_GYR_ODR_200HZ;         /* 200Hz sampling rate */
        config[BMI2_GYRO].cfg.gyr.range = BMI2_GYR_RANGE_2000;      /* ±2000dps range */
        config[BMI2_GYRO].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;       /* Standard filtering */
        config[BMI2_GYRO].cfg.gyr.noise_perf = BMI2_POWER_OPT_MODE;  /* Noise performance */
        config[BMI2_GYRO].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE; /* Filter performance */

        /* Configure interrupt pin */
        pin_config.pin_type = BMI2_INT1;
        pin_config.pin_cfg[0].input_en = BMI2_INT_INPUT_DISABLE;
        pin_config.pin_cfg[0].lvl = BMI2_INT_ACTIVE_LOW;
        pin_config.pin_cfg[0].od = BMI2_INT_PUSH_PULL;
        pin_config.pin_cfg[0].output_en = BMI2_INT_OUTPUT_ENABLE;
        pin_config.int_latch = BMI2_INT_LATCH;

        rslt = bmi2_set_int_pin_config(&pin_config, bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        rslt = bmi2_set_sensor_config(config, 2, bmi2_dev);
        bmi2_error_codes_print_result(rslt);
    }

    return rslt;
}

/**
 * @brief Configure feature interrupt mapping
 *
 * Maps the push and rolling interrupts to INT1 pin and configures interrupt pin properties.
 *
 * @param[in] bmi2_dev Pointer to BMI2 device structure
 *
 * @return BMI2 API execution status
 *      - BMI2_OK: Success
 *      - Other values: Failure
 */
static int8_t set_feature_interrupt(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    uint8_t data = BMI270_TOY_INT_PUSH_MASK | BMI270_TOY_INT_GI_INS1_ROLLING_MASK;
    struct bmi2_int_pin_config pin_config = { 0 };

    /* Map push and rolling interrupts to INT1 pin */
    rslt = bmi2_set_regs(BMI2_INT1_MAP_FEAT_ADDR, &data, 1, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* Configure interrupt pin properties */
        pin_config.pin_type = BMI2_INT1;
        pin_config.pin_cfg[0].input_en = BMI2_INT_INPUT_DISABLE;
        pin_config.pin_cfg[0].lvl = BMI2_INT_ACTIVE_HIGH;
        pin_config.pin_cfg[0].od = BMI2_INT_PUSH_PULL;
        pin_config.pin_cfg[0].output_en = BMI2_INT_OUTPUT_ENABLE;
        pin_config.int_latch = BMI2_INT_LATCH;

        rslt = bmi2_set_int_pin_config(&pin_config, bmi2_dev);
        bmi2_error_codes_print_result(rslt);
    }

    return rslt;
}

/**
 * @brief Adjust high-g threshold for on-table detection
 *
 * This function decreases the high-g threshold to make push detection more sensitive
 * when the sensor is placed on a table.
 *
 * @param[in] bmi2_dev Pointer to BMI2 device structure
 */
static void adjust_high_g_threshold_for_on_table(bmi270_handle_t bmi2_dev)
{
    uint8_t data[2], page;
    int8_t rslt;

    uint8_t aps_stat = bmi2_dev->aps_status;
    if (aps_stat == BMI2_ENABLE) {
        bmi2_set_adv_power_save(BMI2_DISABLE, bmi2_dev);
    }

    page = 4;
    rslt = bmi2_set_regs(0x2f, &page, 1, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    /* Decrease high-g threshold for more sensitive detection */
    uint16_t high_g_threshold = 0x0800;
    data[0] = high_g_threshold & 0xff;
    data[1] = (high_g_threshold >> 8) & 0x7f;
    rslt = bmi2_set_regs(0x30, data, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (aps_stat == BMI2_ENABLE) {
        bmi2_set_adv_power_save(BMI2_ENABLE, bmi2_dev);
    }
}

/**
 * @brief Adjust high-g axis selection based on rolling orientation
 *
 * This function reads the current orientation from the rolling sensor and adjusts
 * the high-g axis selection to ignore the gravity axis, making push detection
 * more accurate for different orientations.
 *
 * @param[in] bmi2_dev Pointer to BMI2 device structure
 */
static void adjust_high_g_axis_by_rolling(bmi270_handle_t bmi2_dev)
{
    uint8_t data[2], page;
    int8_t rslt;

    uint8_t aps_stat = bmi2_dev->aps_status;
    if (aps_stat == BMI2_ENABLE) {
        bmi2_set_adv_power_save(BMI2_DISABLE, bmi2_dev);
    }

    bmi270_enable_toy_high_g(bmi2_dev, BMI2_DISABLE);
    bmi270_enable_toy_push(bmi2_dev, BMI2_DISABLE);
    vTaskDelay(pdMS_TO_TICKS(20));

    uint8_t axes;
    uint8_t select_x = 1;
    uint8_t select_y = 1;
    uint8_t select_z = 1;
    rslt = bmi2_get_regs(0x1e, &axes, 1, bmi2_dev);
    bmi2_error_codes_print_result(rslt);
    axes = axes >> 5;
    if (axes == 1 || axes == 2) {
        select_x = 0;
    } else if (axes == 3 || axes == 4) {
        select_y = 0;
    } else if (axes == 5 || axes == 6) {
        select_z = 0;
    }

    uint8_t high_g_axis_selection = (select_x << 4) | (select_y << 5) | (select_z << 6);

    page = 4;
    rslt = bmi2_set_regs(0x2f, &page, 1, bmi2_dev);
    bmi2_error_codes_print_result(rslt);
    rslt = bmi2_get_regs(0x32, data, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);
    /* Set the axis of gravity to 0 */
    data[1] = (data[1] & 0x8f) | high_g_axis_selection;
    rslt = bmi2_set_regs(0x32, data, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    bmi270_enable_toy_high_g(bmi2_dev, BMI2_ENABLE);
    bmi270_enable_toy_push(bmi2_dev, BMI2_ENABLE);
    vTaskDelay(pdMS_TO_TICKS(20));

    if (aps_stat == BMI2_ENABLE) {
        bmi2_set_adv_power_save(BMI2_ENABLE, bmi2_dev);
    }
}

/**
 * @brief Enable push detection interrupt and handle detection events
 *
 * This function enables the push detection feature, configures interrupts, and enters a loop
 * to handle push detection events. It also automatically adjusts high-g axis selection based
 * on rolling orientation. When a push is detected, it waits 3 seconds before re-enabling
 * the interrupt to avoid repeated triggers.
 *
 * @param[in] bmi2_dev Pointer to BMI2 device structure
 *
 * @return BMI2 API execution status
 *      - BMI2_OK: Success
 *      - Other values: Failure
 */
static int8_t bmi270_toy_enable_push_int(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_GYRO };
    uint8_t int_status = 0;

    /* Disable advanced power save mode */
    rslt = bmi2_set_adv_power_save(BMI2_DISABLE, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    /* Configure accelerometer and gyroscope */
    rslt = set_accel_gyro_config(bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    /* Configure feature interrupt */
    rslt = set_feature_interrupt(bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    /* Enable sensors */
    rslt = bmi2_sensor_enable(sens_list, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    /* Enable push detection feature */
    rslt = bmi270_enable_toy_push(bmi2_dev, BMI2_ENABLE);
    bmi2_error_codes_print_result(rslt);
    ESP_LOGI("MAIN", "Push feature enabled, result: %d", rslt);

    /* Enable rolling to get the direction of gravity */
    rslt = bmi270_enable_toy_rolling(bmi2_dev, BMI2_ENABLE);
    bmi2_error_codes_print_result(rslt);
    ESP_LOGI("MAIN", "Rolling feature enabled, result: %d", rslt);

    /* Delay 500ms to get initial direction */
    vTaskDelay(pdMS_TO_TICKS(500));

    adjust_high_g_axis_by_rolling(bmi2_dev);
    adjust_high_g_threshold_for_on_table(bmi2_dev);

    if (rslt == BMI2_OK) {
        ESP_LOGI("MAIN", "Move the sensor to get push interrupt...");

        while (rslt == BMI2_OK) {
            if (interrupt_status) {
                interrupt_status = false;

                /* Clear buffer */
                int_status = 0;

                rslt = bmi2_get_regs(BMI2_INT_STATUS_0_ADDR, &int_status, 1, bmi2_dev);
                bmi2_error_codes_print_result(rslt);

                if (int_status & BMI270_TOY_INT_PUSH_MASK) {
                    ESP_LOGI("MAIN", "Push generated!");
                    char direction[10] = {0};
                    rslt = bmi270_get_toy_high_g_direction(bmi2_dev, direction);
                    bmi2_error_codes_print_result(rslt);
                    ESP_LOGI("MAIN", "Push direction: %s", direction);

                    /* Remove interrupt handler to avoid repeated triggers */
                    gpio_isr_handler_remove(I2C_INT_IO);
                    ESP_LOGI("MAIN", "Waiting 3 seconds before next detection...");
                    vTaskDelay(pdMS_TO_TICKS(3000));
                    /* Re-add interrupt handler */
                    gpio_isr_handler_add(I2C_INT_IO, gpio_isr_edge_handler, (void*) I2C_INT_IO);
                    ESP_LOGI("MAIN", "Ready for next push detection...");
                }
                if (int_status & BMI270_TOY_INT_GI_INS1_ROLLING_MASK) {
                    ESP_LOGI("MAIN", "Rolling generated");
                    adjust_high_g_axis_by_rolling(bmi2_dev);
                }
            } else {
                vTaskDelay(pdMS_TO_TICKS(100));
            }
        }
    }

    return rslt;
}

/**
 * @brief Main application entry point
 *
 * This function initializes GPIO, I2C, and BMI270, then enables push detection.
 * It also handles cleanup after the detection loop finishes.
 */
void app_main(void)
{
    ESP_LOGI("MAIN", "=== BMI270 TOY Push Detection Configuration ===");
#ifdef CONFIG_BOARD_ESP_SPOT_C5
    ESP_LOGI("MAIN", "Selected Board: ESP SPOT C5");
#elif defined(CONFIG_BOARD_ESP_SPOT_S3)
    ESP_LOGI("MAIN", "Selected Board: ESP SPOT S3");
#elif defined(CONFIG_BOARD_ESP_ASTOM_S3)
    ESP_LOGI("MAIN", "Selected Board: ESP ASTOM S3");
#elif defined(CONFIG_BOARD_ESP_ECHOEAR_S3)
    ESP_LOGI("MAIN", "Selected Board: ESP ECHOEAR S3");
#elif defined(CONFIG_BOARD_CUSTOM)
    ESP_LOGI("MAIN", "Selected Board: Other Boards (Custom)");
#else
    ESP_LOGI("MAIN", "Selected Board: Default (ECHOEAR_S3)");
#endif
    ESP_LOGI("MAIN", "GPIO Configuration:");
    ESP_LOGI("MAIN", "  - Interrupt GPIO: %d", I2C_INT_IO);
    ESP_LOGI("MAIN", "  - I2C SCL GPIO: %d", I2C_MASTER_SCL_IO);
    ESP_LOGI("MAIN", "  - I2C SDA GPIO: %d", I2C_MASTER_SDA_IO);
#ifdef CONFIG_UE_SW_I2C
    ESP_LOGI("MAIN", "  - I2C Type: Software I2C");
#else
    ESP_LOGI("MAIN", "  - I2C Type: Hardware I2C");
#endif
    ESP_LOGI("MAIN", "================================");

    gpio_config_t io_conf = {
        .intr_type = GPIO_INTR_ANYEDGE,
        .pin_bit_mask = (1ULL << I2C_INT_IO),
        .mode = GPIO_MODE_INPUT,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
    };
    gpio_config(&io_conf);

    gpio_install_isr_service(0);
    gpio_isr_handler_add(I2C_INT_IO, gpio_isr_edge_handler, (void*) I2C_INT_IO);

    if (i2c_sensor_bmi270_toy_init() != ESP_OK) {
        ESP_LOGE("MAIN", "BMI270 TOY initialization failed");
        return;
    }

    int8_t rslt = bmi270_toy_enable_push_int(bmi_handle);
    if (rslt != BMI2_OK) {
        ESP_LOGE("MAIN", "BMI270 TOY enable push interrupt failed");
        bmi2_error_codes_print_result(rslt);
    }

    gpio_isr_handler_remove(I2C_INT_IO);
    gpio_uninstall_isr_service();

    bmi270_sensor_del(&bmi_handle);
    i2c_bus_delete(&i2c_bus);

    ESP_LOGI("MAIN", "BMI270 TOY push interrupt example finished.");
}
