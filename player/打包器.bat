@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: --- 1. 設定區 (已指向你的 C 槽路徑) ---
set "ADDON_NAME=MyAddon"
set "ZIP_EXE=C:\Program Files\7-Zip\7z.exe"

:: 強制定位到腳本所在的資料夾 (解決 OneDrive/空格路徑問題)
cd /d "%~dp0"

echo [檢查] 正在確認 7-Zip 狀態...
if not exist "%ZIP_EXE%" (
    echo [錯誤] 在 C:\Program Files\7-Zip\ 沒找到 7z.exe！
    echo 請確認你安裝的是完整版 7-Zip 而非僅有管理員介面。
    pause & exit
)

:: --- 2. 清理舊檔 ---
if exist "%ADDON_NAME%.mcaddon" del "%ADDON_NAME%.mcaddon"

:: --- 3. 自動抓取內容 ---
echo [掃描] 正在抓取資料夾與檔案...
set "INCLUDE_ITEMS="

:: 這裡會自動抓取你目前資料夾下的所有子資料夾 (如 RP, BP 等)
for /d %%d in (*) do (
    echo    - [找到資料夾] %%d
    set INCLUDE_ITEMS=!INCLUDE_ITEMS! "%%d"
)

:: 抓取 manifest 和圖標
for %%f in (manifest.json pack_icon.png) do (
    if exist "%%f" (
        echo    - [找到檔案] %%f
        set INCLUDE_ITEMS=!INCLUDE_ITEMS! "%%f"
    )
)

if "!INCLUDE_ITEMS!"=="" (
    echo [錯誤] 腳本旁邊空空的，沒東西可以打包！
    pause & exit
)

:: --- 4. 執行打包 ---
echo [打包] 正在呼叫 7-Zip 製作 .mcaddon...
:: 使用雙引號包裹變數，防止空格路徑崩潰
"%ZIP_EXE%" a -tzip "%ADDON_NAME%.mcaddon" !INCLUDE_ITEMS! >nul

if exist "%ADDON_NAME%.mcaddon" (
    for %%A in ("%ADDON_NAME%.mcaddon") do set size=%%~zA
    echo.
    echo ========================================
    echo [成功] 打包完成！
    echo 檔案名稱：%ADDON_NAME%.mcaddon
    echo 檔案大小：!size! bytes
    echo ========================================
) else (
    echo [失敗] 7-Zip 執行成功但未生成檔案，請檢查權限。
)

pause