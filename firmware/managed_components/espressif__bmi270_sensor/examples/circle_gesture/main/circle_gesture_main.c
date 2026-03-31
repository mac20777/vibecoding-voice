/*
 * SPDX-FileCopyrightText: 2025 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include <stdio.h>
#include "esp_system.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "bmi270_api.h"

/**
 * @file main.c
 * @brief Example for BMI270 circle gesture detection with ESP32
 *
 * This file demonstrates how to initialize the BMI270 sensor, configure it for circle gesture detection,
 * and handle interrupts using ESP32 GPIO. The code includes I2C initialization, sensor configuration,
 * interrupt service routines, and main application logic.
 */

// Configure GPIO pins based on selected development board
#ifdef CONFIG_BOARD_ESP_SPOT_C5
#define I2C_INT_IO              3
#define I2C_MASTER_SCL_IO       26
#define I2C_MASTER_SDA_IO       25
#define UE_SW_I2C               1
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

// Global handles for BMI270 and I2C bus
static bmi270_handle_t bmi_handle = NULL;
static i2c_bus_handle_t i2c_bus;
static volatile bool interrupt_status = false;

/**
 * @brief GPIO interrupt service routine for BMI270 INT pin
 *
 * This ISR sets the interrupt_status flag when an interrupt is detected on the configured GPIO.
 * @param arg GPIO number (cast from void*)
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
 * This function configures the I2C bus and creates the BMI270 sensor handle.
 * @return ESP_OK on success, ESP_FAIL otherwise
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
 * @brief Configure BMI270 for circle gesture detection and set INT1 pin
 *
 * This function sets up the sensor configuration for circle gesture detection and configures the INT1 pin
 * for interrupt output. It also allows for user customization of sensor parameters.
 * @param bmi2_dev Pointer to BMI2 device structure
 * @return Result code from BMI2 API
 */
static int8_t set_feature_config(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    struct bmi2_sens_config config[2] = { {0} };
    struct bmi2_int_pin_config pin_config = { 0 };

    /* Configure the type of circle gesture detection feature. */
    config[0].type = BMI2_CIRCLE;
    config[1].type = BMI2_ACCEL;

    /* Get default configurations for the type of feature selected. */
    rslt = bmi270_circle_get_sensor_config(config, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Configure INT1 pin for interrupt output
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
        /* User can change the following configuration parameters as required. */
        config[1].cfg.acc.odr = BMI2_ACC_ODR_50HZ; // Set accelerometer ODR

        // Configure circle gesture detection using type casting
        struct bmi2_circle_gest_det_config *circle_cfg = (struct bmi2_circle_gest_det_config *)&config[0].cfg;
        // Set axis of rotation: BMI2_AXIS_SELECTION_X(0x01), BMI2_AXIS_SELECTION_Y(0x02), BMI2_AXIS_SELECTION_Z(0x03)
        circle_cfg->cgd_cfg1.axis_of_rotation = BMI2_AXIS_SELECTION_Z; // Z Axis for horizontal circular motion

        /* Set new configurations. */
        rslt = bmi270_circle_set_sensor_config(config, 2, bmi2_dev);
        bmi2_error_codes_print_result(rslt);
    }

    return rslt;
}

/**
 * @brief Enable circle gesture detection interrupt and handle detection events
 *
 * This function enables the circle gesture detection feature, configures interrupts, and enters a loop
 * to handle gesture detection events. When a gesture is detected, it waits 3 seconds before re-enabling
 * the interrupt to avoid repeated triggers.
 * @param bmi2_dev Pointer to BMI2 device structure
 * @return Result code from BMI2 API
 */
static int8_t bmi270_enable_circle_gesture_int(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_CIRCLE };
    uint16_t int_status = 0;
    uint8_t circle_output;
    uint8_t direction;
    struct bmi2_sens_int_config sens_int = {
        .type = BMI2_CIRCLE,
        .hw_int_pin = BMI2_INT1
    };

    /* Enable the selected sensors. */
    rslt = bmi270_circle_sensor_enable(sens_list, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* Set feature configurations for circle gesture detection. */
        rslt = set_feature_config(bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        if (rslt == BMI2_OK) {
            /* Map the feature interrupt for circle gesture detection. */
            rslt = bmi270_circle_map_feat_int(&sens_int, 1, bmi2_dev);
            bmi2_error_codes_print_result(rslt);
            ESP_LOGI("MAIN", "Move the board in circular motion");

            /* Main loop to handle circle gesture detection interrupts. */
            while (rslt == BMI2_OK) {
                if (interrupt_status) {
                    interrupt_status = false;
                    /* Clear the buffer. */
                    int_status = 0;

                    /* Get the interrupt status of circle gesture detection. */
                    rslt = bmi2_get_int_status(&int_status, bmi2_dev);
                    bmi2_error_codes_print_result(rslt);

                    /* Check the interrupt status for circle gesture detection. */
                    if (int_status & BMI270_CIRCLE_CIRCLE_GESTURE_MASK) {
                        rslt = bmi2_get_regs(BMI270_CIRCLE_CIRCLE_GES_STATUS_REG, &circle_output, 2, bmi2_dev);
                        bmi2_error_codes_print_result(rslt);

                        direction = circle_output & BMI270_CIRCLE_DIRECTION_MASK;
                        circle_output = circle_output & BMI270_CIRCLE_DETECTED_MASK;

                        if (circle_output) {
                            ESP_LOGI("MAIN", "Circle Gesture Detected!");

                            switch (direction) {
                            case BMI270_CIRCLE_DIRECTION_NONE:
                                ESP_LOGI("MAIN", "No direction");
                                break;
                            case BMI270_CIRCLE_DIRECTION_CLOCKWISE:
                                ESP_LOGI("MAIN", "Clockwise direction");
                                break;
                            case BMI270_CIRCLE_DIRECTION_ANTICLOCKWISE:
                                ESP_LOGI("MAIN", "Anti-Clockwise direction");
                                break;
                            default:
                                break;
                            }
                            // 1. Remove interrupt handler to avoid repeated triggers
                            gpio_isr_handler_remove(I2C_INT_IO);
                            ESP_LOGI("MAIN", "Waiting 3 seconds before next detection...");
                            // 2. Delay 3 seconds before re-enabling interrupt
                            vTaskDelay(pdMS_TO_TICKS(3000));
                            // 3. Re-add interrupt handler
                            gpio_isr_handler_add(I2C_INT_IO, gpio_isr_edge_handler, (void*) I2C_INT_IO);
                            ESP_LOGI("MAIN", "Ready for next circle gesture detection...");
                        }
                    }
                } else {
                    vTaskDelay(pdMS_TO_TICKS(100)); // Polling delay
                }
            }
        }
    }

    return rslt;
}

/**
 * @brief Main application entry point
 *
 * This function initializes GPIO, I2C, and BMI270, then enables circle gesture detection.
 * It also handles cleanup after the detection loop finishes.
 */
void app_main(void)
{
    // Configure GPIO for BMI270 interrupt
    gpio_config_t io_conf = {
        .intr_type = GPIO_INTR_ANYEDGE,
        .pin_bit_mask = (1ULL << I2C_INT_IO),
        .mode = GPIO_MODE_INPUT,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
    };
    gpio_config(&io_conf);

    // Install and add ISR service for GPIO interrupt
    gpio_install_isr_service(0);
    gpio_isr_handler_add(I2C_INT_IO, gpio_isr_edge_handler, (void*) I2C_INT_IO);

    // Initialize I2C and BMI270 sensor
    if (i2c_sensor_bmi270_init() != ESP_OK) {
        ESP_LOGE("MAIN", "BMI270 initialization failed");
        return;
    }

    // Enable circle gesture detection interrupt
    int8_t rslt = bmi270_enable_circle_gesture_int(bmi_handle);
    if (rslt != BMI2_OK) {
        ESP_LOGE("MAIN", "BMI270 enable circle gesture interrupt failed");
        bmi2_error_codes_print_result(rslt);
    }

    // Remove ISR handler and uninstall service
    gpio_isr_handler_remove(I2C_INT_IO);
    gpio_uninstall_isr_service();

    // Delete I2C bus and BMI270 handle
    i2c_bus_delete(&i2c_bus);
    bmi270_sensor_del(&bmi_handle);

    ESP_LOGI("MAIN", "BMI270 circle gesture interrupt example finished.");
}
