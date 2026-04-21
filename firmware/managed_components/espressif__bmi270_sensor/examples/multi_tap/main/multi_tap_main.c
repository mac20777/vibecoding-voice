/*
 * SPDX-FileCopyrightText: 2025 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file multi_tap_main.c
 * @brief BMI270 multi-tap detection example for ESP32
 *
 * This example demonstrates how to initialize the BMI270 sensor, configure it for
 * multi-tap (single/double/triple tap) detection, and handle interrupts using ESP32 GPIO.
 * The code includes I2C initialization, sensor configuration, interrupt service routines,
 * and main application logic.
 */

#include <stdio.h>
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
 * This function configures the I2C bus and creates the BMI270 sensor handle with Circle firmware.
 *
 * @return
 *      - ESP_OK: Success
 *      - ESP_FAIL: Initialization failed
 */
static esp_err_t i2c_sensor_bmi270_init(void)
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

    esp_err_t ret = bmi270_sensor_create(i2c_bus, &bmi_handle, bmi270_circle_config_file, BMI2_GYRO_CROSS_SENS_ENABLE | BMI2_CRT_RTOSK_ENABLE);
    if (ret != ESP_OK || bmi_handle == NULL) {
        ESP_LOGE("MAIN", "BMI270_CIRCLE create failed");
        return ESP_FAIL;
    }

    return ESP_OK;
}

/**
 * @brief Configure BMI270 for tap detection and set INT1 pin
 *
 * This function sets up the sensor configuration for tap detection and configures
 * the INT1 pin for interrupt output.
 *
 * @param[in] bmi2_dev Pointer to BMI2 device structure
 *
 * @return BMI2 API execution status
 *      - BMI2_OK: Success
 *      - Other values: Failure
 */
static int8_t set_feature_config(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    struct bmi2_sens_config config[2] = { {0} };
    struct bmi2_int_pin_config pin_config = { 0 };

    /* Configure the type of tap detection feature */
    config[0].type = BMI2_TAP;
    config[1].type = BMI2_ACCEL;

    /* Get default configurations for the type of feature selected */
    rslt = bmi270_circle_get_sensor_config(config, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    rslt = bmi2_get_int_pin_config(&pin_config, bmi2_dev);
    bmi2_error_codes_print_result(rslt);
    if (rslt == BMI2_OK) {
        pin_config.pin_type = BMI2_INT1;
        pin_config.pin_cfg[0].input_en = BMI2_INT_INPUT_DISABLE;
        pin_config.pin_cfg[0].lvl = BMI2_INT_ACTIVE_LOW;
        pin_config.pin_cfg[0].od = BMI2_INT_PUSH_PULL;
        pin_config.pin_cfg[0].output_en = BMI2_INT_OUTPUT_ENABLE;
        pin_config.int_latch = BMI2_INT_NON_LATCH;
        rslt = bmi2_set_int_pin_config(&pin_config, bmi2_dev);
        bmi2_error_codes_print_result(rslt);
    }

    if (rslt == BMI2_OK) {
        /* User can change the following configuration parameters as required */
        config[1].cfg.acc.odr = BMI2_ACC_ODR_50HZ;

        /* Set new configurations */
        rslt = bmi270_circle_set_sensor_config(config, 2, bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        if (rslt == BMI2_OK) {
            ESP_LOGI("MAIN", "Basic configuration set successfully");
        } else {
            ESP_LOGE("MAIN", "Failed to set basic configuration");
        }
    }

    return rslt;
}

/**
 * @brief Enable tap detection interrupt and handle detection events
 *
 * This function enables the tap detection feature, configures interrupts, and enters a loop
 * to handle tap detection events. When a tap is detected, it waits 3 seconds before
 * re-enabling the interrupt to avoid repeated triggers.
 *
 * @param[in] bmi2_dev Pointer to BMI2 device structure
 *
 * @return BMI2 API execution status
 *      - BMI2_OK: Success
 *      - Other values: Failure
 */
static int8_t bmi270_enable_tap_int(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_TRIPLE_TAP };
    uint16_t int_status = 0;
    uint8_t tap_output;
    struct bmi2_sens_int_config sens_int = {
        .type = BMI2_TAP,
        .hw_int_pin = BMI2_INT1
    };

    /* Enable accelerometer */
    uint8_t accel_list[1] = { BMI2_ACCEL };
    rslt = bmi270_circle_sensor_enable(accel_list, 1, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* Set feature configurations for tap detection */
        rslt = set_feature_config(bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        if (rslt == BMI2_OK) {
            /* Enable tap features */
            rslt = bmi270_circle_sensor_enable(sens_list, 2, bmi2_dev);
            bmi2_error_codes_print_result(rslt);

            if (rslt == BMI2_OK) {
                ESP_LOGI("MAIN", "Tap feature enabled successfully");
            } else {
                ESP_LOGE("MAIN", "Failed to enable tap feature");
            }

            if (rslt == BMI2_OK) {
                /* Map the feature interrupt for tap detection */
                rslt = bmi270_circle_map_feat_int(&sens_int, 1, bmi2_dev);
                bmi2_error_codes_print_result(rslt);
                ESP_LOGI("MAIN", "Tap the board to detect triple tap");

                /* Main loop to handle tap detection interrupts */
                while (rslt == BMI2_OK) {
                    if (interrupt_status) {
                        interrupt_status = false;
                        ESP_LOGI("MAIN", "Interrupt detected!");

                        /* Clear the buffer */
                        int_status = 0;

                        /* Get the interrupt status of tap detection */
                        rslt = bmi2_get_int_status(&int_status, bmi2_dev);
                        bmi2_error_codes_print_result(rslt);

                        /* Check the interrupt status for tap detection */
                        if (int_status & BMI270_CIRCLE_MULTI_TAP_MASK) {
                            ESP_LOGI("MAIN", "Tap interrupt detected!");
                            rslt = bmi2_get_regs(BMI270_CIRCLE_TAP_STATUS_REG, &tap_output, 1, bmi2_dev);
                            bmi2_error_codes_print_result(rslt);
                            ESP_LOGI("MAIN", "Tap output: 0x%02X", tap_output);

                            /* Check for triple tap */
                            if (tap_output & BMI270_CIRCLE_TRIPLE_TAP_MASK) {
                                ESP_LOGI("MAIN", "Triple Tap Detected!");
                            } else {
                                ESP_LOGI("MAIN", "Other tap detected (not triple)");
                            }

                            /* Remove interrupt handler to avoid repeated triggers */
                            gpio_isr_handler_remove(I2C_INT_IO);
                            ESP_LOGI("MAIN", "Waiting 3 seconds before next detection...");
                            vTaskDelay(pdMS_TO_TICKS(3000));
                            /* Re-add interrupt handler */
                            gpio_isr_handler_add(I2C_INT_IO, gpio_isr_edge_handler, (void*) I2C_INT_IO);
                            ESP_LOGI("MAIN", "Ready for next tap detection...");
                        }
                    } else {
                        vTaskDelay(pdMS_TO_TICKS(100));
                    }
                }
            }
        }
    }

    return rslt;
}

/**
 * @brief Main application entry point
 *
 * This function initializes GPIO, I2C, and BMI270, then enables tap detection.
 * It also handles cleanup after the detection loop finishes.
 */
void app_main(void)
{
    gpio_config_t io_conf = {
        .intr_type = GPIO_INTR_NEGEDGE,
        .pin_bit_mask = (1ULL << I2C_INT_IO),
        .mode = GPIO_MODE_INPUT,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
    };
    gpio_config(&io_conf);

    gpio_install_isr_service(0);
    gpio_isr_handler_add(I2C_INT_IO, gpio_isr_edge_handler, (void*) I2C_INT_IO);

    if (i2c_sensor_bmi270_init() != ESP_OK) {
        ESP_LOGE("MAIN", "BMI270 initialization failed");
        return;
    }

    int8_t rslt = bmi270_enable_tap_int(bmi_handle);
    if (rslt != BMI2_OK) {
        ESP_LOGE("MAIN", "BMI270 enable tap interrupt failed");
        bmi2_error_codes_print_result(rslt);
    }

    gpio_isr_handler_remove(I2C_INT_IO);
    gpio_uninstall_isr_service();

    i2c_bus_delete(&i2c_bus);
    bmi270_sensor_del(&bmi_handle);

    ESP_LOGI("MAIN", "BMI270 tap detection interrupt example finished.");
}
