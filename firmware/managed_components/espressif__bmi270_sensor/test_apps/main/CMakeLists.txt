idf_component_register(SRCS "bmi270_test.c"
                    INCLUDE_DIRS "."
                    REQUIRES bmi270_sensor unity esp_timer esp_driver_gpio)
