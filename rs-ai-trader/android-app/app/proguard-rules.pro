# Keep serialization metadata for the API DTOs.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.rsaitrader.core.network.** {
    *** Companion;
}
-keepclasseswithmembers class com.rsaitrader.core.network.** {
    kotlinx.serialization.KSerializer serializer(...);
}
# OkHttp/Retrofit
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
