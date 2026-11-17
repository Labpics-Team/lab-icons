plugins {
    kotlin("jvm") version "2.3.21"
    kotlin("plugin.compose") version "2.3.21"
    id("org.jetbrains.compose") version "1.12.2"
    application
}
kotlin {
    jvmToolchain(21)
    sourceSets.main { kotlin.srcDir(providers.gradleProperty("exportedIconSource").get()) }
}
dependencies {
    implementation("pics.lab:icons-compose:${providers.gradleProperty("iconsVersion").get()}")
    implementation(compose.desktop.currentOs)
    implementation("org.jetbrains.compose.foundation:foundation:1.12.2")
}
application { mainClass = "pics.lab.icons.consumer.MainKt" }
