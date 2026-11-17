pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositories {
        maven { url = uri(providers.gradleProperty("iconsRepository").get()) }
        google(); mavenCentral()
    }
}
rootProject.name = "icons-compose-consumer"
