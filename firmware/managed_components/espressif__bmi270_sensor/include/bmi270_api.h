/*
 * SPDX-FileCopyrightText: 2025 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file bmi270_api.h
 * @brief BMI270 Sensor API
 *
 * The BMI270 is a small, low power, low noise inertial measurement unit (IMU) designed
 * for use in mobile applications like gesture recognition and navigation, which require
 * highly accurate, real-time sensor data.
 *
 * This sensor integrates a 16-bit tri-axial accelerometer and a 16-bit tri-axial gyroscope,
 * supporting multiple intelligent feature detections:
 * - Gesture recognition (circle gesture, tap, shake, etc.)
 * - Motion detection (any motion, no motion, free fall, etc.)
 * - Rotation angle measurement
 * - Step counting
 *
 * @version 0.1.0
 * @date 2025.10
 */

#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/******************************************************************************/
/*!                           Header Dependencies                              */
/******************************************************************************/
#include <stdint.h>
#include "esp_err.h"
#include "i2c_bus.h"
#include "bmi2_defs.h"
#include "bmi2.h"

#define BMI270_CHIP_ID                       UINT8_C(0x24)
#define BMI270_I2C_ADDRESS                   UINT8_C(0x68)

#define BMI270_CONFIG_FILE_SIZE              8192

#define BMI2_ACCEL                           UINT8_C(0)
#define BMI2_GYRO                            UINT8_C(1)
#define BMI2_INT_STATUS_0_ADDR               UINT8_C(0x1C)
#define BMI270_CIRCLE_CIRCLE_GES_STATUS_REG  UINT8_C(0x1E)
#define BMI270_CIRCLE_TAP_STATUS_REG         UINT8_C(0x20)

/******************************************************************************/
/*!                Standard Firmware Feature Interrupt Status Bit Masks        */
/******************************************************************************/
#define BMI270_SIG_MOT_STATUS_MASK           UINT8_C(0x01)
#define BMI270_STEP_CNT_STATUS_MASK          UINT8_C(0x02)
#define BMI270_STEP_ACT_STATUS_MASK          UINT8_C(0x04)
#define BMI270_WRIST_WAKE_UP_STATUS_MASK     UINT8_C(0x08)
#define BMI270_WRIST_GEST_STATUS_MASK        UINT8_C(0x10)
#define BMI270_NO_MOT_STATUS_MASK            UINT8_C(0x20)
#define BMI270_ANY_MOT_STATUS_MASK           UINT8_C(0x40)

/******************************************************************************/
/*!            Circle Firmware Feature Interrupt Mapping Bit Masks             */
/******************************************************************************/
#define BMI270_CIRCLE_CIRCLE_GESTURE_MASK    UINT8_C(0x01)
#define BMI270_CIRCLE_GEN_INT_MASK           UINT8_C(0x02)
#define BMI270_CIRCLE_MULTI_TAP_MASK         UINT8_C(0x08)
#define BMI270_CIRCLE_SINGLE_TAP_MASK        UINT8_C(0x01)
#define BMI270_CIRCLE_DOUBLE_TAP_MASK        UINT8_C(0x02)
#define BMI270_CIRCLE_TRIPLE_TAP_MASK        UINT8_C(0x04)
#define BMI270_CIRCLE_NO_MOT_MASK            UINT8_C(0x20)
#define BMI270_CIRCLE_ANY_MOT_MASK           UINT8_C(0x40)

/******************************************************************************/
/*!              Toy Firmware Feature Interrupt Mapping Bit Masks              */
/******************************************************************************/
#define BMI270_TOY_INT_TOY_MOTION_MASK       UINT8_C(0x01)
#define BMI270_TOY_INT_HIGH_LOW_G_MASK       UINT8_C(0x02)
#define BMI270_TOY_INT_PUSH_MASK             UINT8_C(0x04)
#define BMI270_TOY_INT_TAP_MASK              UINT8_C(0x08)
#define BMI270_TOY_INT_GI_INS1_ROLLING_MASK  UINT8_C(0x10)
#define BMI270_TOY_INT_NO_MOT_MASK           UINT8_C(0x20)
#define BMI270_TOY_INT_ANY_MOT_MASK          UINT8_C(0x40)
#define BMI270_TOY_INT_SHAKE_MASK            UINT8_C(0x80)

/******************************************************************************/
/*!                        Axis Selection Constants                            */
/******************************************************************************/
#define BMI2_AXIS_SELECTION_X                UINT8_C(0x01)
#define BMI2_AXIS_SELECTION_Y                UINT8_C(0x02)
#define BMI2_AXIS_SELECTION_Z                UINT8_C(0x03)

/******************************************************************************/
/*!                Circle Gesture Direction Masks and Values                   */
/******************************************************************************/
#define BMI270_CIRCLE_DIRECTION_MASK         UINT8_C(0x07)
#define BMI270_CIRCLE_DETECTED_MASK          UINT8_C(0x08)
#define BMI270_CIRCLE_DIRECTION_NONE         UINT8_C(0x00)
#define BMI270_CIRCLE_DIRECTION_CLOCKWISE    UINT8_C(0x01)
#define BMI270_CIRCLE_DIRECTION_ANTICLOCKWISE UINT8_C(0x02)

/******************************************************************************/
/*!                Toy Motion Gesture Type Masks and Values                    */
/******************************************************************************/
#define BMI270_TOY_GESTURE_TYPE_MASK         UINT8_C(0x1C)
#define BMI270_TOY_GESTURE_PICK_UP           UINT8_C(0x01)
#define BMI270_TOY_GESTURE_PUT_DOWN          UINT8_C(0x02)
#define BMI270_TOY_GESTURE_THROW_UP          UINT8_C(0x03)
#define BMI270_TOY_GESTURE_THROW_DOWN        UINT8_C(0x04)
#define BMI270_TOY_GESTURE_THROW_CATCH       UINT8_C(0x05)

/******************************************************************************/
/*!                           Type Definitions                                 */
/******************************************************************************/

/**
 * @brief BMI270 I2C configuration structure
 *
 * This structure contains the I2C configuration parameters required to communicate
 * with the BMI270 sensor.
 */
typedef struct {
    i2c_bus_handle_t i2c_handle;    /*!< I2C bus handle used to connect to the BMI270 device */
    uint8_t     i2c_addr;           /*!< I2C address of the BMI270 device (typically 0x68) */
} bmi270_i2c_config_t;

/**
 * @brief BMI270 sensor handle type
 *
 * This is an opaque handle that represents a BMI270 sensor instance.
 * It should be used with the BMI270 API functions to perform sensor operations.
 */
typedef struct bmi2_dev * bmi270_handle_t;

/******************************************************************************/
/*!              BMI270 Circle Firmware-Specific Structure Definitions         */
/******************************************************************************/

/**
 * @brief Multi-tap detection configuration structure
 *
 * Used to configure tap detector parameters for BMI270 Circle firmware
 */
struct bmi2_multitap_config {
    uint16_t settings_1;    /*!< Tap detector configuration parameter 1 */
    uint16_t settings_2;    /*!< Tap detector configuration parameter 2 */
    uint16_t settings_3;    /*!< Tap detector configuration parameter 3 */
};

/**
 * @brief Circle gesture detection configuration group 1
 *
 * Contains rotation axis and basic threshold settings
 */
struct bmi2_circle_gest_settings1 {
    uint16_t axis_of_rotation;      /*!< Rotation axis selection (X/Y/Z) */
    uint16_t threshold;             /*!< Detection threshold */
};

/**
 * @brief Circle gesture detection configuration group 2
 *
 * Contains detection sensitivity and timeout settings
 */
struct bmi2_circle_gest_settings2 {
    uint16_t threshold_detection;
    uint16_t wait_for_timeout;
};

/**
 * @brief Circle gesture detection configuration group 3
 *
 * Contains gesture duration and quiet time settings
 */
struct bmi2_circle_gest_settings3 {
    uint16_t minimum_gesture_duration;
    uint16_t maximum_gesture_duration;
    uint16_t quiet_time_after_circle;
};

/**
 * @brief Complete circle gesture detection configuration structure
 *
 * Contains all configuration parameters for circle gesture detection
 */
struct bmi2_circle_gest_det_config {
    uint16_t enable;
    struct bmi2_circle_gest_settings1 cgd_cfg1;
    struct bmi2_circle_gest_settings2 cgd_cfg2;
    struct bmi2_circle_gest_settings3 cgd_cfg3;
};

/**
 * @brief Generic interrupt configuration structure
 *
 * Used to configure generic interrupt parameters for BMI270 Circle firmware
 */
struct bmi2_generic_int_config {
    uint16_t gen_int_settings_1;
    uint16_t gen_int_settings_2;
    uint16_t gen_int_settings_3;
    uint16_t gen_int_settings_4;
    uint16_t gen_int_settings_5;
    uint16_t gen_int_settings_6;
    uint16_t gen_int_settings_7;
};

/******************************************************************************/
/*!                      BMI270 API Function Prototypes                        */
/******************************************************************************/

/**
 * @brief Create a BMI270 sensor instance
 *
 * This function creates BMI270 sensor instances with different configurations based on the provided config file.
 * It handles memory allocation, interface initialization, and sensor-specific initialization.
 *
 * @note Supported firmware files:
 *       - bmi270_image.h: Standard BMI270 functionality
 *       - bmi270_circle_image.h: Circle gesture detection
 *       - bmi270_toy_image.h: Toy motion detection
 *
 * @param[in] i2c_handle I2C bus handle used to connect to the BMI270 device
 * @param[out] handle_ret Pointer to a variable that will hold the created sensor handle
 * @param[in] config_file Pointer to the sensor-specific configuration file
 * @param[in] variant_feature Variant-specific features to enable (e.g., BMI2_GYRO_CROSS_SENS_ENABLE | BMI2_CRT_RTOSK_ENABLE)
 *
 * @return
 *      - ESP_OK: Successfully created the sensor object
 *      - ESP_ERR_INVALID_ARG: Invalid arguments were provided
 *      - ESP_ERR_NO_MEM: Memory allocation failed
 *      - ESP_ERR_INVALID_STATE: Sensor initialization failed
 *      - ESP_FAIL: Failed to initialize the sensor
 */
esp_err_t bmi270_sensor_create(i2c_bus_handle_t i2c_handle, bmi270_handle_t *handle_ret, const uint8_t *config_file, uint64_t variant_feature);

/**
 * @brief Delete a BMI270 sensor instance
 *
 * This function deletes a BMI270 sensor instance and frees all associated resources.
 * It handles resource cleanup and memory deallocation.
 *
 * @param[in,out] handle Pointer to the BMI270 sensor handle to delete
 *
 * @return
 *      - ESP_OK: Successfully deleted the sensor object
 *      - ESP_ERR_INVALID_ARG: Invalid handle was provided
 *      - ESP_FAIL: Failed to delete the sensor object
 *
 * @note This function should be called when the sensor is no longer needed to prevent memory leaks.
 */
esp_err_t bmi270_sensor_del(bmi270_handle_t *handle);

/******************************************************************************/
/*!         Low-Level Hardware Abstraction Layer (HAL) Functions              */
/******************************************************************************/

/**
 * @brief Function for reading the sensor's registers through I2C bus
 *
 * @param[in] reg_addr     Register address
 * @param[out] reg_data    Pointer to the data buffer to store the read data
 * @param[in] len          Number of bytes to read
 * @param[in] intf_ptr     Pointer to the I2C device handle (set by bmi2_interface_init)
 *
 * @return Status of execution
 *         - BMI2_INTF_RET_SUCCESS: Success
 *         - Other values: Failure Info
 */
BMI2_INTF_RETURN_TYPE bmi2_i2c_read(uint8_t reg_addr, uint8_t *reg_data, uint32_t len, void *intf_ptr);

/**
 * @brief Function for writing the sensor's registers through I2C bus
 *
 * @param[in] reg_addr     Register address
 * @param[in] reg_data     Pointer to the data buffer whose value is to be written
 * @param[in] len          Number of bytes to write
 * @param[in] intf_ptr     Pointer to the I2C device handle (set by bmi2_interface_init)
 *
 * @return Status of execution
 *         - BMI2_INTF_RET_SUCCESS: Success
 *         - Other values: Failure Info
 */
BMI2_INTF_RETURN_TYPE bmi2_i2c_write(uint8_t reg_addr, const uint8_t *reg_data, uint32_t len, void *intf_ptr);

/**
 * @brief Function for reading the sensor's registers through SPI bus
 *
 * @param[in] reg_addr     Register address
 * @param[out] reg_data    Pointer to the data buffer to store the read data
 * @param[in] len          Number of bytes to read
 * @param[in] intf_ptr     Pointer to the SPI device handle (set by bmi2_interface_init)
 *
 * @return Status of execution
 *         - BMI2_INTF_RET_SUCCESS: Success
 *         - Other values: Failure Info
 */
BMI2_INTF_RETURN_TYPE bmi2_spi_read(uint8_t reg_addr, uint8_t *reg_data, uint32_t len, void *intf_ptr);

/**
 * @brief Function for writing the sensor's registers through SPI bus
 *
 * @param[in] reg_addr     Register address
 * @param[in] reg_data     Pointer to the data buffer whose data has to be written
 * @param[in] len          Number of bytes to write
 * @param[in] intf_ptr     Pointer to the SPI device handle (set by bmi2_interface_init)
 *
 * @return Status of execution
 *         - BMI2_INTF_RET_SUCCESS: Success
 *         - Other values: Failure Info
 */
BMI2_INTF_RETURN_TYPE bmi2_spi_write(uint8_t reg_addr, const uint8_t *reg_data, uint32_t len, void *intf_ptr);

/**
 * @brief This function provides the delay for required time (Microsecond) as per the input provided in some of the APIs
 *
 * @param[in] period       The required wait time in microsecond
 * @param[in] intf_ptr     Interface pointer
 *
 * @return void
 */
void bmi2_delay_us(uint32_t period, void *intf_ptr);

/**
 * @brief Prints the execution status of the APIs
 *
 * @param[in] rslt     Error code returned by the API whose execution status has to be printed
 *
 * @return void
 */
void bmi2_error_codes_print_result(int8_t rslt);

/**
 * @brief Initialize BMI270 interface (I2C or SPI)
 *
 * This function initializes the communication interface for the BMI270 sensor.
 * It sets up the interface type, device address, and communication bus handle.
 *
 * @param[in] handle       BMI270 device handle
 * @param[in] intf         Interface type (BMI2_I2C_INTF or BMI2_SPI_INTF)
 * @param[in] dev_addr     Device address (for I2C, typically 0x68 or 0x69; for SPI, typically chip select pin)
 * @param[in] bus_inst     Bus handle pointer (i2c_bus_handle_t* for I2C, spi_bus_handle_t* for SPI, or NULL if not applicable)
 *
 * @return Result of API execution status
 *         - BMI2_OK: Success
 *         - BMI2_E_NULL_PTR: Null pointer error
 *         - Other negative values: Failure
 */
int8_t bmi2_interface_init(bmi270_handle_t handle, uint8_t intf, uint8_t dev_addr, void *bus_inst);

/**
 * @brief Deinitializes BMI2 interface
 *
 * @return void
 */
void bmi2_interface_deinit(void);

/******************************************************************************/
/*!                           BMI270 Core Functions                           */
/******************************************************************************/

/**
 * @defgroup bmi270_core_functions BMI270 Core Functions
 * @brief Forward declarations for BMI270 core driver functions
 * @{
 */
int8_t bmi270_sensor_enable(const uint8_t *sens_list, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_get_sensor_config(struct bmi2_sens_config *sens_cfg, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_set_sensor_config(struct bmi2_sens_config *sens_cfg, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_map_feat_int(const struct bmi2_sens_int_config *sens_int, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_get_feature_data(struct bmi2_feat_sensor_data *feature_data, uint8_t n_sens, bmi270_handle_t dev);
/** @} */ // end of bmi270_core_functions

/**
 * @defgroup bmi270_circle_functions BMI270 Circle Firmware Functions
 * @brief Forward declarations for BMI270 Circle firmware functions
 * @{
 */
int8_t bmi270_circle_get_sensor_config(struct bmi2_sens_config *sens_cfg, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_circle_set_sensor_config(struct bmi2_sens_config *sens_cfg, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_circle_sensor_enable(const uint8_t *sens_list, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_circle_map_feat_int(const struct bmi2_sens_int_config *sens_int, uint8_t n_sens, bmi270_handle_t dev);
/** @} */ // end of bmi270_circle_functions

/**
 * @defgroup bmi270_toy_functions BMI270 Toy Firmware Functions
 * @brief Forward declarations for BMI270 Toy firmware functions
 * @{
 */
int8_t bmi270_toy_get_sensor_config(struct bmi2_sens_config *sens_cfg, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_toy_set_sensor_config(struct bmi2_sens_config *sens_cfg, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_toy_sensor_enable(const uint8_t *sens_list, uint8_t n_sens, bmi270_handle_t dev);
int8_t bmi270_toy_map_feat_int(const struct bmi2_sens_int_config *sens_int, uint8_t n_sens, bmi270_handle_t dev);
/** @} */ // end of bmi270_toy_functions

/**
 * @defgroup bmi270_toy_motion_functions BMI270 Toy Motion Feature Functions
 * @brief High-level API functions for Toy motion feature control
 * @{
 */
/**
 * @brief Enable/disable all toy motion features (any-motion, no-motion, low-g, generic interrupt)
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_motion(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable any-motion detection only
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_any_motion(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable no-motion detection only
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_no_motion(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable low-g detection only
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_low_g(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable generic interrupt 2 only
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_generic_interrupt_ins2(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable high-g detection
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_high_g(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable tap detection (single, double, triple)
 * @param[in] dev               BMI270 device handle
 * @param[in] single_tap_enable Enable single tap detection (BMI2_ENABLE/BMI2_DISABLE)
 * @param[in] double_tap_enable Enable double tap detection (BMI2_ENABLE/BMI2_DISABLE)
 * @param[in] triple_tap_enable Enable triple tap detection (BMI2_ENABLE/BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_tap(bmi270_handle_t dev, uint8_t single_tap_enable, uint8_t double_tap_enable, uint8_t triple_tap_enable);

/**
 * @brief Enable/disable rolling detection
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_rolling(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable rotation angle measurement
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_rotation_angle(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable generic interrupt 1
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_generic_interrupt_ins1(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable push detection (combines high-g, generic interrupt, and shake)
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_push(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Enable/disable shake detection
 * @param[in] dev    BMI270 device handle
 * @param[in] enable Enable (BMI2_ENABLE) or disable (BMI2_DISABLE)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_enable_toy_shake(bmi270_handle_t dev, uint8_t enable);

/**
 * @brief Get the direction of high-g event
 * @param[in] dev       BMI270 device handle
 * @param[out] direction Pointer to char buffer to store direction string (min 3 bytes)
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_get_toy_high_g_direction(bmi270_handle_t dev, char *direction);

/**
 * @brief Get the rotation angle measurement
 * @param[in] dev          BMI270 device handle
 * @param[out] output_status Pointer to status byte (0=no valid data, 1=valid)
 * @param[out] output_angle  Pointer to float to store rotation angle in degrees
 * @return Result of API execution status (BMI2_OK on success)
 */
int8_t bmi270_get_toy_rotation_angle(bmi270_handle_t dev, uint8_t *output_status, float *output_angle);
/** @} */ // end of bmi270_toy_motion_functions

/******************************************************************************/
/*!                  Configuration File Declarations                           */
/******************************************************************************/

/**
 * @brief Standard BMI270 configuration file
 */
extern const uint8_t bmi270_config_file[];
extern const uint8_t bmi270_circle_config_file[];
extern const uint8_t bmi270_toy_config_file[];

/******************************************************************************/
/*!                           C++ Guard Macros                                 */
/******************************************************************************/
#ifdef __cplusplus
}
#endif // End of CPP guard
