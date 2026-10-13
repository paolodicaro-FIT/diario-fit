plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "it.paololab3d.diariofit.activitybridge"
    compileSdk = 35
    defaultConfig {
        applicationId = "it.paololab3d.diariofit.activitybridge"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1-test"
    }
}
dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.browser:browser:1.8.0")
}
