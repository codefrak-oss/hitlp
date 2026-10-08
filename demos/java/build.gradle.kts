plugins {
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.codefrak:hitlp")
    // The SDK's schema validator logs through SLF4J; the demo keeps it quiet.
    runtimeOnly("org.slf4j:slf4j-nop:2.0.16")
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile>().configureEach {
    options.release = 17
    options.encoding = "UTF-8"
}

application {
    mainClass = "hello.Hello"
}

tasks.named<JavaExec>("run") {
    standardInput = System.`in`
}

tasks.test {
    useJUnitPlatform()
}
