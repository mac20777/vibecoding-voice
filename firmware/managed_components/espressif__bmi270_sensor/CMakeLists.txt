if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/bmi270_api.c")
file(GLOB sources "*.c")
set(priv_include_dirs "priv_include")
else()
set(sources "")
set(priv_include_dirs)
endif()

idf_component_register( SRCS ${sources}
                        INCLUDE_DIRS "include"
                        PRIV_INCLUDE_DIRS ${priv_include_dirs}
                        REQUIRES i2c_bus
                        PRIV_REQUIRES esp_timer)

if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/bmi270_api.c")
    add_prebuilt_library(bmi270_lib "${CMAKE_CURRENT_SOURCE_DIR}/${IDF_VERSION_MAJOR}.${IDF_VERSION_MINOR}/${CONFIG_IDF_TARGET}/libbmi270_sensor.a")
    target_include_directories(${COMPONENT_LIB} INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/include")
    target_link_libraries(${COMPONENT_LIB} INTERFACE bmi270_lib)
else()
    include(package_manager)
    cu_pkg_define_version(${CMAKE_CURRENT_LIST_DIR})
    target_compile_options(${COMPONENT_LIB} PRIVATE -Wignored-qualifiers)
endif()
