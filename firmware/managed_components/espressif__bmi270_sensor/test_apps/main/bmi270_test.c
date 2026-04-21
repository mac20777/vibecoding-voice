/*
 * SPDX-FileCopyrightText: 2025 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include "esp_log.h"
#include "driver/gpio.h"
#include "unity.h"
#include "bmi270_api.h"

#define TEST_MEMORY_LEAK_THRESHOLD (-400)

/*! Earth's gravity in m/s^2 */
#define GRAVITY_EARTH       (9.80665f)

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
#elif defined(CONFIG_BOARD_CUSTOM)
#define I2C_INT_IO              CONFIG_I2C_INT_IO
#define I2C_MASTER_SCL_IO       CONFIG_I2C_MASTER_SCL_IO
#define I2C_MASTER_SDA_IO       CONFIG_I2C_MASTER_SDA_IO
#define UE_SW_I2C               CONFIG_UE_SW_I2C
#else
// Default configuration - if no board is selected, use ECHOEAR_S3 configuration
#define I2C_INT_IO              21
#define I2C_MASTER_SCL_IO       1
#define I2C_MASTER_SDA_IO       2
#define UE_SW_I2C               0
#endif

#define I2C_MASTER_NUM          I2C_NUM_0               /*!< I2C port number for master dev */
#define I2C_MASTER_FREQ_HZ      100 * 1000                /*!< I2C master clock frequency */

static bmi270_handle_t bmi_handle = NULL;
static bmi270_handle_t bmi_circle_handle = NULL;
static bmi270_handle_t bmi_toy_handle = NULL;
static i2c_bus_handle_t i2c_bus;

bool interrupt_status = false;

static const char *TAG = "bmi270_test";

/**
 * @brief GPIO interrupt service routine
 */
static void IRAM_ATTR gpio_isr_edge_handler(void* arg)
{
    uint32_t gpio_num = (uint32_t) arg;
    interrupt_status = true;
    esp_rom_printf("GPIO[%"PRIu32"] intr, val: %d\n", gpio_num, gpio_get_level(gpio_num));
}

/**
 * @brief Configure and install GPIO interrupt for sensor
 */
static void setup_gpio_interrupt(void)
{
    gpio_config_t io_conf = {
        .intr_type = GPIO_INTR_ANYEDGE,
        .pin_bit_mask = (1ULL << I2C_INT_IO),
        .mode = GPIO_MODE_INPUT,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
    };
    gpio_config(&io_conf);
    gpio_install_isr_service(0);
    gpio_isr_handler_add(I2C_INT_IO, gpio_isr_edge_handler, (void*)I2C_INT_IO);
}

/**
 * @brief Remove GPIO interrupt handler
 */
static void cleanup_gpio_interrupt(void)
{
    gpio_isr_handler_remove(I2C_INT_IO);
    gpio_uninstall_isr_service();
}

/**
 * @brief Common I2C bus initialization
 */
static void i2c_bus_init(void)
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
    TEST_ASSERT_NOT_NULL_MESSAGE(i2c_bus, "i2c_bus create returned NULL");
}

/**
 * @brief i2c master initialization
 */
static void i2c_sensor_bmi270_init(void)
{
    i2c_bus_init();

    bmi270_sensor_create(i2c_bus, &bmi_handle, bmi270_config_file, BMI2_GYRO_CROSS_SENS_ENABLE | BMI2_CRT_RTOSK_ENABLE);
    TEST_ASSERT_NOT_NULL_MESSAGE(bmi_handle, "BMI270 create returned NULL");
}

/**
 * @brief i2c master initialization for circle gesture
 */
static void i2c_sensor_bmi270_circle_init(void)
{
    i2c_bus_init();

    bmi270_sensor_create(i2c_bus, &bmi_circle_handle, bmi270_circle_config_file, BMI2_GYRO_CROSS_SENS_ENABLE | BMI2_CRT_RTOSK_ENABLE);
    TEST_ASSERT_NOT_NULL_MESSAGE(bmi_circle_handle, "BMI270_CIRCLE create returned NULL");
}

/**
 * @brief i2c master initialization for toy motion
 */
static void i2c_sensor_bmi270_toy_init(void)
{
    i2c_bus_init();

    bmi270_sensor_create(i2c_bus, &bmi_toy_handle, bmi270_toy_config_file, 0);
    TEST_ASSERT_NOT_NULL_MESSAGE(bmi_toy_handle, "BMI270_TOY create returned NULL");
}

/*!
 * @brief This function converts lsb to meter per second squared for 16 bit accelerometer at
 * range 2G, 4G, 8G or 16G.
 */
static float lsb_to_mps2(int16_t val, float g_range, uint8_t bit_width)
{
    double power = 2;

    float half_scale = (float)((pow((double)power, (double)bit_width) / 2.0f));

    return (GRAVITY_EARTH * val * g_range) / half_scale;
}

/*!
 * @brief This function converts lsb to degree per second for 16 bit gyro at
 * range 125, 250, 500, 1000 or 2000dps.
 */
static float lsb_to_dps(int16_t val, float dps, uint8_t bit_width)
{
    double power = 2;

    float half_scale = (float)((pow((double)power, (double)bit_width) / 2.0f));

    return (dps / (half_scale)) * (val);
}

/*!
 * @brief This internal API sets the sensor configuration
 */
static int8_t set_wrist_gesture_config(bmi270_handle_t bmi2_dev)
{
    /* Variable to define result */
    int8_t rslt;

    /* List the sensors which are required to enable */
    uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_WRIST_GESTURE };

    /* Structure to define the type of the sensor and its configurations */
    struct bmi2_sens_config config;

    /* Configure type of feature */
    config.type = BMI2_WRIST_GESTURE;

    /* Enable the selected sensors */
    rslt = bmi270_sensor_enable(sens_list, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* Get default configurations for the type of feature selected */
        rslt = bmi270_get_sensor_config(&config, 1, bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        if (rslt == BMI2_OK) {
            config.cfg.wrist_gest.wearable_arm = BMI2_ARM_LEFT;

            /* Set the new configuration along with interrupt mapping */
            rslt = bmi270_set_sensor_config(&config, 1, bmi2_dev);
            bmi2_error_codes_print_result(rslt);
        }
    }

    return rslt;
}

/*!
 * @brief This internal API is used to set configurations for accel and gyro.
 */
static int8_t set_accel_gyro_config(bmi270_handle_t bmi)
{
    /* Status of api are returned to this variable. */
    int8_t rslt;

    /* Structure to define accelerometer and gyro configuration. */
    struct bmi2_sens_config config[2];

    /* Configure the type of feature. */
    config[BMI2_ACCEL].type = BMI2_ACCEL;
    config[BMI2_GYRO].type = BMI2_GYRO;

    /* Get default configurations for the type of feature selected. */
    rslt = bmi2_get_sensor_config(config, 2, bmi);
    bmi2_error_codes_print_result(rslt);

    /* Map data ready interrupt to interrupt pin. */
    rslt = bmi2_map_data_int(BMI2_DRDY_INT, BMI2_INT1, bmi);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* NOTE: The user can change the following configuration parameters according to their requirement. */
        /* Set Output Data Rate */
        config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_200HZ;

        /* Gravity range of the sensor (+/- 2G, 4G, 8G, 16G). */
        config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_2G;

        /* The bandwidth parameter is used to configure the number of sensor samples that are averaged
         * if it is set to 2, then 2^(bandwidth parameter) samples
         * are averaged, resulting in 4 averaged samples.
         * Note1 : For more information, refer the datasheet.
         * Note2 : A higher number of averaged samples will result in a lower noise level of the signal, but
         * this has an adverse effect on the power consumed.
         */
        config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;

        /* Enable the filter performance mode where averaging of samples
         * will be done based on above set bandwidth and ODR.
         * There are two modes
         *  0 -> Ultra low power mode
         *  1 -> High performance mode(Default)
         * For more info refer datasheet.
         */
        config[BMI2_ACCEL].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE;

        /* The user can change the following configuration parameters according to their requirement. */
        /* Set Output Data Rate */
        config[BMI2_GYRO].cfg.gyr.odr = BMI2_GYR_ODR_200HZ;

        /* Gyroscope Angular Rate Measurement Range.By default the range is 2000dps. */
        config[BMI2_GYRO].cfg.gyr.range = BMI2_GYR_RANGE_2000;

        /* Gyroscope bandwidth parameters. By default the gyro bandwidth is in normal mode. */
        config[BMI2_GYRO].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;

        /* Enable/Disable the noise performance mode for precision yaw rate sensing
         * There are two modes
         *  0 -> Ultra low power mode(Default)
         *  1 -> High performance mode
         */
        config[BMI2_GYRO].cfg.gyr.noise_perf = BMI2_POWER_OPT_MODE;

        /* Enable/Disable the filter performance mode where averaging of samples
         * will be done based on above set bandwidth and ODR.
         * There are two modes
         *  0 -> Ultra low power mode
         *  1 -> High performance mode(Default)
         */
        config[BMI2_GYRO].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE;

        /* Set the accel and gyro configurations. */
        rslt = bmi2_set_sensor_config(config, 2, bmi);
        bmi2_error_codes_print_result(rslt);
    }

    return rslt;
}

static int8_t bmi270_enable_wrist_gesture(bmi270_handle_t bmi2_dev)
{
    /* Variable to define result */
    int8_t rslt;

    /* Initialize status of wrist gesture interrupt */
    uint16_t int_status = 0;

    /* Select features and their pins to be mapped to */
    struct bmi2_sens_int_config sens_int = { .type = BMI2_WRIST_GESTURE, .hw_int_pin = BMI2_INT1 };

    /* Sensor data structure */
    struct bmi2_feat_sensor_data sens_data = { .type = BMI2_WRIST_GESTURE };

    /* The gesture movements are listed in array */
    const char *gesture_output[6] =
    { "unknown_gesture", "push_arm_down", "pivot_up", "wrist_shake_jiggle", "flick_in", "flick_out" };

    /* Set the sensor configuration */
    rslt = set_wrist_gesture_config(bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* Map the feature interrupt */
        rslt = bmi270_map_feat_int(&sens_int, 1, bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        if (rslt == BMI2_OK) {
            ESP_LOGI(TAG, "Flip the board in portrait/landscape mode:");

            /* Loop to print the wrist gesture data when interrupt occurs */
            for (;;) {
                /* Get the interrupt status of the wrist gesture */
                rslt = bmi2_get_int_status(&int_status, bmi2_dev);
                bmi2_error_codes_print_result(rslt);

                if ((rslt == BMI2_OK) && (int_status & BMI270_WRIST_GEST_STATUS_MASK)) {
                    ESP_LOGI(TAG, "Wrist gesture detected");

                    /* Get wrist gesture output */
                    rslt = bmi270_get_feature_data(&sens_data, 1, bmi2_dev);
                    bmi2_error_codes_print_result(rslt);

                    ESP_LOGI(TAG, "Wrist gesture = %d", sens_data.sens_data.wrist_gesture_output);

                    ESP_LOGI(TAG, "Gesture output = %s", gesture_output[sens_data.sens_data.wrist_gesture_output]);
                    break;
                }
            }
        }
    }
    return rslt;
}

int8_t bmi270_enable_accel_gyro(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;

    /* Assign accel and gyro sensor to variable. */
    uint8_t sensor_list[2] = { BMI2_ACCEL, BMI2_GYRO };

    /* Structure to define type of sensor and their respective data. */
    struct bmi2_sens_data sensor_data;

    uint8_t indx = 1;

    float acc_x = 0, acc_y = 0, acc_z = 0;
    float gyr_x = 0, gyr_y = 0, gyr_z = 0;
    struct bmi2_sens_config config;
    /* Accel and gyro configuration settings. */
    rslt = set_accel_gyro_config(bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* NOTE:
         * Accel and Gyro enable must be done after setting configurations
         */
        rslt = bmi2_sensor_enable(sensor_list, 2, bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        if (rslt == BMI2_OK) {
            config.type = BMI2_ACCEL;

            /* Get the accel configurations. */
            rslt = bmi2_get_sensor_config(&config, 1, bmi2_dev);
            bmi2_error_codes_print_result(rslt);

            ESP_LOGI(TAG, "Data set, Accel Range, Acc_Raw_X, Acc_Raw_Y, Acc_Raw_Z, Acc_ms2_X, Acc_ms2_Y, Acc_ms2_Z, Gyr_Raw_X, Gyr_Raw_Y, Gyr_Raw_Z, Gyro_DPS_X, Gyro_DPS_Y, Gyro_DPS_Z");

            while (indx <= 10) {
                rslt = bmi2_get_sensor_data(&sensor_data, bmi2_dev);
                bmi2_error_codes_print_result(rslt);

                if ((rslt == BMI2_OK) && (sensor_data.status & BMI2_DRDY_ACC) &&
                        (sensor_data.status & BMI2_DRDY_GYR)) {
                    /* Converting lsb to meter per second squared for 16 bit accelerometer at 2G range. */
                    acc_x = lsb_to_mps2(sensor_data.acc.x, BMI2_ACC_RANGE_2G_VAL, bmi2_dev->resolution);
                    acc_y = lsb_to_mps2(sensor_data.acc.y, BMI2_ACC_RANGE_2G_VAL, bmi2_dev->resolution);
                    acc_z = lsb_to_mps2(sensor_data.acc.z, BMI2_ACC_RANGE_2G_VAL, bmi2_dev->resolution);

                    /* Converting lsb to degree per second for 16 bit gyro at 2000dps range. */
                    gyr_x = lsb_to_dps(sensor_data.gyr.x, BMI2_GYR_RANGE_2000_VAL, bmi2_dev->resolution);
                    gyr_y = lsb_to_dps(sensor_data.gyr.y, BMI2_GYR_RANGE_2000_VAL, bmi2_dev->resolution);
                    gyr_z = lsb_to_dps(sensor_data.gyr.z, BMI2_GYR_RANGE_2000_VAL, bmi2_dev->resolution);

                    ESP_LOGI(TAG, "%d, acc:(%6d, %6d, %6d) (%8.2f, %8.2f, %8.2f) gyr:(%6d, %6d, %6d) (%8.2f, %8.2f, %8.2f)",
                             config.cfg.acc.range,
                             sensor_data.acc.x,
                             sensor_data.acc.y,
                             sensor_data.acc.z,
                             acc_x,
                             acc_y,
                             acc_z,
                             sensor_data.gyr.x,
                             sensor_data.gyr.y,
                             sensor_data.gyr.z,
                             gyr_x,
                             gyr_y,
                             gyr_z);
                    vTaskDelay(pdMS_TO_TICKS(500));
                    indx++;
                }
            }
        }
    }

    return rslt;
}

/*!
 * @brief This internal API is used to set configurations for any-motion.
 */
static int8_t set_feature_config(bmi270_handle_t bmi2_dev)
{

    /* Status of api are returned to this variable. */
    int8_t rslt;

    /* Structure to define the type of sensor and its configurations. */
    struct bmi2_sens_config config;

    /* Interrupt pin configuration */
    struct bmi2_int_pin_config pin_config = { 0 };

    /* Configure the type of feature. */
    config.type = BMI2_ANY_MOTION;

    /* Get default configurations for the type of feature selected. */
    rslt = bmi270_get_sensor_config(&config, 1, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    rslt = bmi2_get_int_pin_config(&pin_config, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* NOTE: The user can change the following configuration parameters according to their requirement. */
        /* 1LSB equals 20ms. Default is 100ms, setting to 80ms. */
        config.cfg.any_motion.duration = BMI2_ANY_NO_MOT_DUR_80_MSEC;

        /* 1LSB equals to 0.48mg. Default is 83mg, setting to 50mg. */
        config.cfg.any_motion.threshold = UINT16_C(104);  /* ~50mg (104 * 0.48mg) */

        /* Set new configurations. */
        rslt = bmi270_set_sensor_config(&config, 1, bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        /* Interrupt pin configuration */
        pin_config.pin_type = BMI2_INT1;
        pin_config.pin_cfg[0].input_en = BMI2_INT_INPUT_DISABLE;
        pin_config.pin_cfg[0].lvl = BMI2_INT_ACTIVE_LOW;
        pin_config.pin_cfg[0].od = BMI2_INT_PUSH_PULL;
        pin_config.pin_cfg[0].output_en = BMI2_INT_OUTPUT_ENABLE;
        pin_config.int_latch = BMI2_INT_NON_LATCH;

        rslt = bmi2_set_int_pin_config(&pin_config, bmi2_dev);
        bmi2_error_codes_print_result(rslt);
    }

    return rslt;
}

int8_t bmi270_enable_any_motion_int(bmi270_handle_t bmi2_dev)
{
    /* Status of api are returned to this variable. */
    int8_t rslt;

    /* Accel sensor and no-motion feature are listed in array. */
    uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_ANY_MOTION };

    /* Variable to get no-motion interrupt status. */
    uint16_t int_status = 0;

    /* Select features and their pins to be mapped to. */
    struct bmi2_sens_int_config sens_int = { .type = BMI2_ANY_MOTION, .hw_int_pin = BMI2_INT1 };

    /* Enable the selected sensors. */
    rslt = bmi270_sensor_enable(sens_list, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* Set feature configurations for no-motion. */
        rslt = set_feature_config(bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        if (rslt == BMI2_OK) {
            /* Map the feature interrupt for no-motion. */
            rslt = bmi270_map_feat_int(&sens_int, 1, bmi2_dev);
            bmi2_error_codes_print_result(rslt);
            ESP_LOGI(TAG, "Move the board");

            /* Loop to get no-motion interrupt. */
            do {
                if (interrupt_status == 1) {
                    interrupt_status = 0;
                    /* Clear buffer. */
                    int_status = 0;

                    /* To get the interrupt status of any-motion. */
                    rslt = bmi2_get_int_status(&int_status, bmi2_dev);
                    bmi2_error_codes_print_result(rslt);

                    /* To check the interrupt status of any-motion. */
                    if (int_status & BMI270_ANY_MOT_STATUS_MASK) {
                        ESP_LOGI(TAG, "Any-motion interrupt is generated");
                        break;
                    }
                } else {
                    vTaskDelay(pdMS_TO_TICKS(100));
                }
            } while (rslt == BMI2_OK);
        }
    }

    return rslt;
}

/*!
 * @brief This internal API is used to set configurations for circle gesture detection.
 */
static int8_t set_circle_gesture_config(bmi270_handle_t bmi2_dev)
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

        // Set circle gesture detection config using type casting
        struct bmi2_circle_gest_det_config *circle_cfg = (struct bmi2_circle_gest_det_config *)&config[0].cfg;
        // Set axis of rotation (X, Y, or Z)
        circle_cfg->cgd_cfg1.axis_of_rotation = BMI2_AXIS_SELECTION_Z;

        /* Set new configurations. */
        rslt = bmi270_circle_set_sensor_config(config, 2, bmi2_dev);
        bmi2_error_codes_print_result(rslt);
    }

    return rslt;
}

int8_t bmi270_enable_circle_gesture_int(bmi270_handle_t bmi2_dev)
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
        rslt = set_circle_gesture_config(bmi2_dev);
        bmi2_error_codes_print_result(rslt);

        if (rslt == BMI2_OK) {
            /* Map the feature interrupt for circle gesture detection. */
            rslt = bmi270_circle_map_feat_int(&sens_int, 1, bmi2_dev);
            bmi2_error_codes_print_result(rslt);
            ESP_LOGI(TAG, "Move the board in circular motion to detect gesture");

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
                            ESP_LOGI(TAG, "Circle Gesture Detected!");

                            switch (direction) {
                            case BMI270_CIRCLE_DIRECTION_NONE:
                                ESP_LOGI(TAG, "No direction");
                                break;
                            case BMI270_CIRCLE_DIRECTION_CLOCKWISE:
                                ESP_LOGI(TAG, "Clockwise direction");
                                break;
                            case BMI270_CIRCLE_DIRECTION_ANTICLOCKWISE:
                                ESP_LOGI(TAG, "Anti-Clockwise direction");
                                break;
                            default:
                                break;
                            }
                            break; // Exit loop after detection
                        }
                    }
                } else {
                    vTaskDelay(pdMS_TO_TICKS(100));
                }
            }
        }
    }

    return rslt;
}

/*!
 * @brief This internal API is used to set configurations for toy motion detection.
 */
static int8_t set_toy_motion_accel_gyro_config(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    struct bmi2_sens_config config[2];
    struct bmi2_int_pin_config pin_config = { 0 };

    config[0].type = BMI2_ACCEL;
    config[1].type = BMI2_GYRO;

    rslt = bmi2_get_int_pin_config(&pin_config, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    rslt = bmi2_get_sensor_config(config, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* Set Output Data Rate */
        config[0].cfg.acc.odr = BMI2_ACC_ODR_200HZ;
        config[0].cfg.acc.range = BMI2_ACC_RANGE_16G;
        config[0].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;
        config[0].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE;

        config[1].cfg.gyr.odr = BMI2_GYR_ODR_200HZ;
        config[1].cfg.gyr.range = BMI2_GYR_RANGE_2000;
        config[1].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;
        config[1].cfg.gyr.noise_perf = BMI2_POWER_OPT_MODE;
        config[1].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE;

        /* Interrupt pin configuration */
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

/*!
 * @brief This internal API is used to set feature interrupt for toy motion.
 */
static int8_t set_toy_motion_feature_interrupt(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    uint8_t data = BMI270_TOY_INT_TOY_MOTION_MASK;
    struct bmi2_int_pin_config pin_config = { 0 };

    // Map toy-motion interrupt to INT1
    rslt = bmi2_set_regs(BMI2_INT1_MAP_FEAT_ADDR, &data, 1, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (rslt == BMI2_OK) {
        /* Interrupt pin configuration */
        pin_config.pin_type = BMI2_INT1;
        pin_config.pin_cfg[0].input_en = BMI2_INT_INPUT_DISABLE;
        pin_config.pin_cfg[0].lvl = BMI2_INT_ACTIVE_LOW;
        pin_config.pin_cfg[0].od = BMI2_INT_PUSH_PULL;
        pin_config.pin_cfg[0].output_en = BMI2_INT_OUTPUT_ENABLE;
        pin_config.int_latch = BMI2_INT_LATCH;

        rslt = bmi2_set_int_pin_config(&pin_config, bmi2_dev);
        bmi2_error_codes_print_result(rslt);
    }

    return rslt;
}

/*!
 * @brief This internal API is used to adjust toy motion configuration.
 */
static void adjust_toy_motion_config(bmi270_handle_t bmi2_dev)
{
    uint8_t data[2], page;
    int8_t rslt;

    uint8_t aps_stat = bmi2_dev->aps_status;
    if (aps_stat == BMI2_ENABLE) {
        bmi2_set_adv_power_save(BMI2_DISABLE, bmi2_dev);
    }

    // Config throw parameter
    page = 4;
    rslt = bmi2_set_regs(0x2f, &page, 1, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Adjust parameters to better distinguish different throw gestures
    uint16_t throw_min_duration = 0x06;      // Increase minimum duration to reduce false triggers
    uint16_t throw_up_duration = 0x03;       // Increase throw up duration to improve throw up recognition
    uint16_t low_g_exit_duration = 0x02;     // Increase low-g exit duration to improve throw down recognition
    uint16_t quiet_time_duration = 0x04;     // Increase quiet time duration to improve throw catch recognition

    rslt = bmi2_get_regs(0x36, data, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);
    data[0] = (data[0] & 0x1f) | ((throw_min_duration << 5) & 0xe0);
    data[1] = ((throw_up_duration << 0) & 0x07) | ((low_g_exit_duration << 3) & 0x18) | ((quiet_time_duration << 5) & 0xe0);
    rslt = bmi2_set_regs(0x36, data, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Config generic interrupt ins2 parameter, it's used for collision detection, which will impact the detection of throw down
    page = 6;
    rslt = bmi2_set_regs(0x2f, &page, 1, bmi2_dev);
    bmi2_error_codes_print_result(rslt);
    uint16_t slope_thres = 0x1000;  // Increase slope threshold to reduce throw down being misidentified as collision
    rslt = bmi2_get_regs(0x32, data, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);
    data[0] = slope_thres & 0xff;
    data[1] = (data[1] & 0xf0) | ((slope_thres >> 8) & 0x0f);
    rslt = bmi2_set_regs(0x32, data, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    if (aps_stat == BMI2_ENABLE) {
        bmi2_set_adv_power_save(BMI2_ENABLE, bmi2_dev);
    }
}

int8_t bmi270_enable_toy_motion_int(bmi270_handle_t bmi2_dev)
{
    int8_t rslt;
    uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_GYRO };
    uint8_t int_status = 0;

    // disable aps mode
    rslt = bmi2_set_adv_power_save(BMI2_DISABLE, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Set accel/gyro config
    rslt = set_toy_motion_accel_gyro_config(bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Set feature interrupt
    rslt = set_toy_motion_feature_interrupt(bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Enable sensors
    rslt = bmi2_sensor_enable(sens_list, 2, bmi2_dev);
    bmi2_error_codes_print_result(rslt);

    // Adjust toy motion configuration
    adjust_toy_motion_config(bmi2_dev);

    // Enable toy-motion feature
    rslt = bmi270_enable_toy_motion(bmi2_dev, BMI2_ENABLE);
    bmi2_error_codes_print_result(rslt);
    ESP_LOGI(TAG, "Toy-motion feature enabled, result: %d", rslt);

    if (rslt == BMI2_OK) {
        ESP_LOGI(TAG, "Move the sensor to detect toy-motion gestures (Need 3 gestures to complete test)");

        int gesture_count = 0;
        while (rslt == BMI2_OK && gesture_count < 6) {
            if (interrupt_status) {
                interrupt_status = false;

                /* Clear buffer. */
                int_status = 0;

                rslt = bmi2_get_regs(BMI2_INT_STATUS_0_ADDR, &int_status, 1, bmi2_dev);
                bmi2_error_codes_print_result(rslt);

                if (int_status & BMI270_TOY_INT_TOY_MOTION_MASK) {
                    uint8_t data;
                    rslt = bmi2_get_regs(0x1e, &data, 1, bmi2_dev);
                    bmi2_error_codes_print_result(rslt);

                    uint8_t gesture_type = (data & BMI270_TOY_GESTURE_TYPE_MASK) >> 2;
                    gesture_count++;
                    ESP_LOGI(TAG, "Toy motion detected #%d - Raw data: 0x%02X, Gesture type: 0x%02X", gesture_count, data, gesture_type);

                    switch (gesture_type) {
                    case BMI270_TOY_GESTURE_PICK_UP:
                        ESP_LOGI(TAG, "*** PICK UP generated ***");
                        break;
                    case BMI270_TOY_GESTURE_PUT_DOWN:
                        ESP_LOGI(TAG, "*** PUT DOWN generated ***");
                        break;
                    case BMI270_TOY_GESTURE_THROW_UP:
                        ESP_LOGI(TAG, "*** THROW UP generated ***");
                        break;
                    case BMI270_TOY_GESTURE_THROW_DOWN:
                        ESP_LOGI(TAG, "*** THROW DOWN generated ***");
                        break;
                    case BMI270_TOY_GESTURE_THROW_CATCH:
                        ESP_LOGI(TAG, "*** THROW CATCH generated ***");
                        break;
                    default:
                        ESP_LOGI(TAG, "*** UNKNOWN gesture: 0x%02X ***", gesture_type);
                        break;
                    }

                    if (gesture_count >= 3) {
                        ESP_LOGI(TAG, "Test completed! Detected %d gestures.", gesture_count);
                        break;
                    } else {
                        ESP_LOGI(TAG, "Need %d more gestures to complete test.", 3 - gesture_count);
                    }
                }
            } else {
                vTaskDelay(pdMS_TO_TICKS(100));
            }
        }
    }

    return rslt;
}

TEST_CASE("sensor Bmi270 test", "[Bmi270][sensor][wrist_gesture]")
{
    esp_err_t ret = ESP_OK;

    i2c_sensor_bmi270_init();

    int8_t rslt = bmi270_enable_wrist_gesture(bmi_handle);
    bmi2_error_codes_print_result(rslt);
    TEST_ASSERT_EQUAL(BMI2_OK, rslt);

    bmi270_sensor_del(&bmi_handle);
    ret = i2c_bus_delete(&i2c_bus);
    TEST_ASSERT_EQUAL(ESP_OK, ret);
}

TEST_CASE("sensor Bmi270 test", "[Bmi270][sensor][accel_gyro]")
{
    esp_err_t ret = ESP_OK;

    i2c_sensor_bmi270_init();

    int8_t rslt = bmi270_enable_accel_gyro(bmi_handle);
    bmi2_error_codes_print_result(rslt);
    TEST_ASSERT_EQUAL(BMI2_OK, rslt);

    bmi270_sensor_del(&bmi_handle);
    ret = i2c_bus_delete(&i2c_bus);
    TEST_ASSERT_EQUAL(ESP_OK, ret);
}

TEST_CASE("sensor Bmi270 test", "[Bmi270][sensor][BMI2_ANY_MOTION][BMI2_INT1]")
{
    esp_err_t ret = ESP_OK;

    setup_gpio_interrupt();
    i2c_sensor_bmi270_init();

    int8_t rslt = bmi270_enable_any_motion_int(bmi_handle);
    bmi2_error_codes_print_result(rslt);
    TEST_ASSERT_EQUAL(BMI2_OK, rslt);

    cleanup_gpio_interrupt();
    bmi270_sensor_del(&bmi_handle);
    ret = i2c_bus_delete(&i2c_bus);
    TEST_ASSERT_EQUAL(ESP_OK, ret);
}

TEST_CASE("sensor Bmi270 test", "[Bmi270][sensor][circle_gesture]")
{
    esp_err_t ret = ESP_OK;

    setup_gpio_interrupt();
    i2c_sensor_bmi270_circle_init();

    int8_t rslt = bmi270_enable_circle_gesture_int(bmi_circle_handle);
    bmi2_error_codes_print_result(rslt);
    TEST_ASSERT_EQUAL(BMI2_OK, rslt);

    cleanup_gpio_interrupt();
    bmi270_sensor_del(&bmi_circle_handle);
    ret = i2c_bus_delete(&i2c_bus);
    TEST_ASSERT_EQUAL(ESP_OK, ret);
}

TEST_CASE("sensor Bmi270 test", "[Bmi270][sensor][toy_motion]")
{
    esp_err_t ret = ESP_OK;

    setup_gpio_interrupt();
    i2c_sensor_bmi270_toy_init();

    int8_t rslt = bmi270_enable_toy_motion_int(bmi_toy_handle);
    bmi2_error_codes_print_result(rslt);
    TEST_ASSERT_EQUAL(BMI2_OK, rslt);

    cleanup_gpio_interrupt();
    bmi270_sensor_del(&bmi_toy_handle);
    ret = i2c_bus_delete(&i2c_bus);
    TEST_ASSERT_EQUAL(ESP_OK, ret);
}

static size_t before_free_8bit;
static size_t before_free_32bit;

static void check_leak(size_t before_free, size_t after_free, const char *type)
{
    ssize_t delta = after_free - before_free;
    ESP_LOGI(TAG, "MALLOC_CAP_%s: Before %u bytes free, After %u bytes free (delta %d)", type, before_free, after_free, delta);
    TEST_ASSERT_MESSAGE(delta >= TEST_MEMORY_LEAK_THRESHOLD, "memory leak");
}

void setUp(void)
{
    before_free_8bit = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    before_free_32bit = heap_caps_get_free_size(MALLOC_CAP_32BIT);
}

void tearDown(void)
{
    size_t after_free_8bit = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    size_t after_free_32bit = heap_caps_get_free_size(MALLOC_CAP_32BIT);
    check_leak(before_free_8bit, after_free_8bit, "8BIT");
    check_leak(before_free_32bit, after_free_32bit, "32BIT");
}

void app_main(void)
{
    ESP_LOGI(TAG, "BMI270 TEST");
    unity_run_menu();
}
