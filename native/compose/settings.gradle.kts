pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://raw.githubusercontent.com/Labpics-Team/lab-motion/maven-compose-v0.1.0/")
        google(); mavenCentral()
    }
}
rootProject.name = "icons-compose"
