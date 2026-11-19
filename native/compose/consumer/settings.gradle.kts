pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositories {
        maven("https://raw.githubusercontent.com/Labpics-Team/lab-motion/maven-compose-v0.1.0/")
        maven { url = uri(providers.gradleProperty("iconsRepository").get()) }
        google(); mavenCentral()
    }
}
rootProject.name = "icons-compose-consumer"
