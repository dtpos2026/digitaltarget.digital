# Rider aur Order Taker Android apps — poora tareeqa

Dono apps ki config pehle se maujood hai:

| App | Config file | Package name | Kaunsa page kholta hai |
|---|---|---|---|
| DT Rider | `capacitor.rider.config.json` | `com.digitaltarget.dtrider` | `/#/rider-portal` |
| DT Order Taker | `capacitor.ordertaker.config.json` | `com.digitaltarget.dtordertaker` | `/#/order-taker` |

## Pehle ek zaroori baat — ye apps kaam kaise karte hain

Ye **native apps nahi** hain jin mein poora POS bundle hota hai. Ye ek patli
Android shell hain jo `https://digitaltarget.digital` ko full-screen kholte hain
(config ke `server.url` se).

Faida: **app ko dobara build karne ki zaroorat nahi** jab aap website update
karen. Aap `wrangler pages deploy` karte hain, aur apps agli baar khulne pe
nayi build khud le lete hain.

APK sirf tab dobara banani hai jab **icon, naam, ya package id** badle.

### Ek bug jo maine theek kiya

Dono configs `https://dtpostaimoor.lovable.app` pe point kar rahe thay — purana
Lovable preview URL, aap ki asal domain nahi. Us par banai gayi APK **purani
website** kholti, aur agar wo URL band ho jaye to app khali screen dikhati.

Ab dono `https://digitaltarget.digital` pe hain.

---

## Zaroori software (ek dafa)

1. **Node.js 20+** — pehle se hai
2. **Java JDK 21** — https://adoptium.net (Temurin 21 LTS)
3. **Android Studio** — https://developer.android.com/studio

Android Studio kholte waqt SDK install hone dein. Phir
**More Actions → SDK Manager** mein tasdeeq karein:
- Android SDK Platform 34 ya upar
- Android SDK Build-Tools
- Android SDK Platform-Tools

### Environment variables (Windows)

`JAVA_HOME` aur `ANDROID_HOME` set karein:

```cmd
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot"
setx ANDROID_HOME "%LOCALAPPDATA%\Android\Sdk"
```

CMD **band kar ke naya kholen** — warna ye variables nahi lagenge.

Check:
```cmd
java -version
echo %ANDROID_HOME%
```

---

## Step 1 — Capacitor install (ek dafa)

```cmd
cd "E:\Software Zip File\...\DT_POS_v1.25.2"
npm install
npm install --save-dev @capacitor/cli
npm install @capacitor/core @capacitor/android @capacitor/geolocation @capacitor/splash-screen
```

`@capacitor/geolocation` zaroori hai — rider app live location bhejta hai.

## Step 2 — Web build

```cmd
npm run build
```

`dist/` banta hai. Capacitor ko iski zaroorat hai kyunki config mein
`"webDir": "dist"` likha hai — halanke app asal mein live URL kholta hai.

## Step 3 — Rider app ka Android project banayen

```cmd
npx cap add android --config capacitor.rider.config.json
```

`android/Rider/` folder ban jayega.

## Step 4 — Icon lagayen

`android-icons/` folder mein saare icons tayyar hain. Copy karein:

```cmd
xcopy /E /Y android-icons\mipmap-* android\Rider\app\src\main\res\
```

Ya haath se: har `mipmap-*` folder ki files
`android\Rider\app\src\main\res\mipmap-*\` mein rakhen.

## Step 5 — APK banayen

```cmd
npx cap sync android --config capacitor.rider.config.json
cd android\Rider
gradlew.bat assembleDebug
```

APK yahan milegi:
```
android\Rider\app\build\outputs\apk\debug\app-debug.apk
```

Ye phone pe install kar ke test karein.

## Step 6 — Order Taker app (wahi tareeqa)

```cmd
cd "E:\Software Zip File\...\DT_POS_v1.25.2"
npx cap add android --config capacitor.ordertaker.config.json
xcopy /E /Y android-icons\mipmap-* android\OrderTaker\app\src\main\res\
npx cap sync android --config capacitor.ordertaker.config.json
cd android\OrderTaker
gradlew.bat assembleDebug
```

---

## Play Store ke liye — signed release APK/AAB

Debug APK sirf test ke liye hai. Play Store signed build maangta hai.

### Keystore banayen (ek dafa, dono apps ke liye alag)

```cmd
keytool -genkey -v -keystore dtrider.keystore -alias dtrider ^
  -keyalg RSA -keysize 2048 -validity 10000
```

⚠️ **Ye keystore file aur password kabhi na khoyen.** Kho gayi to us app ki
koi update Play Store pe kabhi publish nahi ho sakti — Google ise recover nahi
karta. Backup kisi mehfooz jagah rakhen.

### Gradle ko keystore batayen

`android\Rider\app\build.gradle` mein `android { }` ke andar:

```gradle
signingConfigs {
    release {
        storeFile file('../../dtrider.keystore')
        storePassword 'aapka-password'
        keyAlias 'dtrider'
        keyPassword 'aapka-password'
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
    }
}
```

### Release build

```cmd
gradlew.bat assembleRelease     :: APK  — seedha install ke liye
gradlew.bat bundleRelease       :: AAB  — Play Store isi ko maangta hai
```

Files:
```
app\build\outputs\apk\release\app-release.apk
app\build\outputs\bundle\release\app-release.aab
```

Play Store listing ka 512x512 icon: `android-icons\play-store-512.png`

---

## Permissions — rider app ke liye zaroori

`android\Rider\app\src\main\AndroidManifest.xml` mein `<application>` se
**pehle** ye lines honi chahiyen:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

Location ke baghair rider ki live tracking kaam nahi karegi.

---

## Website update karne ke baad

**Kuch nahi karna.** Apps live URL kholte hain, to `wrangler pages deploy` ke
baad wo khud nayi build utha lenge.

APK sirf tab dobara banayen jab icon, app ka naam, package id ya permissions
badlen.

---

## Browser ka icon

Ye web build mein already lag chuka hai:

| File | Kahan dikhta hai |
|---|---|
| `public/favicon.ico` | Browser tab (16/32/48/64/128/256 sizes andar) |
| `public/favicon.png` | Modern browsers |
| `public/apple-touch-icon.png` | iPhone "Add to Home Screen" |
| `public/pwa-icon-192.png` / `-512.png` | Android PWA install |

Deploy ke baad agar purana "D" icon nazar aaye to **browser ne favicon cache
kar rakha hai** — ye bug nahi hai. Ctrl+Shift+R karein, ya tab band kar ke
dobara kholen.

### Icon mein wordmark kyun nahi hai

Poora logo ("DIGITAL TARGET" likha hua) 32 pixel ke tab icon mein bilkul
na-qabil-e-parhai ho jata hai — sirf ek dhabba nazar aata. Is liye icons ke
liye **sirf nishan (mark)** liya hai, purple background ke saath. Splash screen
pe poora logo hai, kyunki wahan jagah hai.

Icon mein nishan 58% jagah leta hai — Android aur iOS launcher icons ko gol
kaat dete hain, aur 58% us safe zone ke andar rehta hai.
