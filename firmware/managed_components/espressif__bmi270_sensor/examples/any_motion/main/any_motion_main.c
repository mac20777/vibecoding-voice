/*
 * SPDX-FileCopyrightText: 2025 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file any_motion_main.c
 * @brief BMI270 any-motion detection example for ESP32
 *
 * This example demonstrates how to initialize the BMI270 sensor, configure it for
 * any-motion detection, and handle interrupts using ESP32 GPIO. The code includes
 * I2C initialization, sensor configuration, interrupt service routines, and main
 * application logic.
 */

#include <stdio.h>
#include <stdbool.h>
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
        config[BMI2_GYRO].cfg.gyr.noise_perf = BMI2_PERF_OPT_MODE;  /* Noise performance */
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
 * Maps the any-motion interrupt to INT1 pin and configures interrupt pin properties.
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
    uint8_t data = BMI270_TOY_INT_ANY_MOT_MASK;
    struct bmi2_int_pin_config pin_config = { 0 };

    /* Map any-motion interrupt to INT1 pin */
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

static int8_t bmi270_toy_enable_any_motion_int(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_GYRO };
    uint8_t int_status = 0;

    // disable aps mode
    rslt = bmi2_set_adv_power_save(BMI2_DISABLE, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Set accel/gyro config
    rslt = set_accel_gyro_config(bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Set feature interrupt
    rslt = set_feature_interrupt(bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Enable sensors
    rslt = bmi2_sensor_enable(sens_list, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Enable any-motion feature
    rslt = bmi270_enable_toy_any_motion(bmi2_dev, BMI2_ENABLE);
    bmi2_error_codes_print_result(rslt);
    ESP_LOGI("MAIN", "Any-motion feature enabled, result: %d", rslt);

    if (rslt == BMI2_OK) {
        ESP_LOGI("MAIN", "Move the sensor to get any-motion interrupt...");

        while (rslt == BMI2_OK) {
            if (interrupt_status) {
                interrupt_status = false;

                /* Clear buffer. */
                int_status = 0;

                rslt = bmi2_get_regs(BMI2_INT_STATUS_0_ADDR, &int_status, 1, bmi2_dev);
                bmi2_error_codes_print_result(rslt);

                if (int_status & BMI270_TOY_INT_ANY_MOT_MASK) {
                    ESP_LOGI("MAIN", "Any motion detected!");

                    // 1. Remove interrupt handler to avoid repeated triggers
                    gpio_isr_handler_remove(I2C_INT_IO);
                    ESP_LOGI("MAIN", "Waiting 3 seconds before next detection...");
                    // 2. Delay 3 seconds before re-enabling interrupt
                    vTaskDelay(pdMS_TO_TICKS(3000));
                    // 3. Re-add interrupt handler
                    gpio_isr_handler_add(I2C_INT_IO, gpio_isr_edge_handler, (void*) I2C_INT_IO);
                    ESP_LOGI("MAIN", "Ready for next any motion detection...");
                }
            } else {
                vTaskDelay(pdMS_TO_TICKS(100));
            }
        }
    }

    return rslt;
}

void app_main(void)
{
    // Print current configuration information
    ESP_LOGI("MAIN", "=== BMI270 TOY Any-Motion Detection Configuration ===");
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

    int8_t rslt = bmi270_toy_enable_any_motion_int(bmi_handle);
    bmi2_error_codes_print_result(rslt);
    if (rslt != BMI2_OK) {
        ESP_LOGE("MAIN", "BMI270 TOY enable any-motion interrupt failed");
    }

    gpio_isr_handler_remove(I2C_INT_IO);
    gpio_uninstall_isr_service();

    bmi270_sensor_del(&bmi_handle);
    i2c_bus_delete(&i2c_bus);

    ESP_LOGI("MAIN", "BMI270 TOY any-motion interrupt example finished.");
}
