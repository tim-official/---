# OBS Studio 33 + телесуфлер (Windows)

1. Скопируйте папку `obs-teleprompter` на ПК.
2. Дважды кликните `run-setup.bat`. Если SmartScreen спросит — «Подробнее → Выполнить в любом случае».

Скрипт закрывает OBS, делает бэкап в `%APPDATA%\obs-studio\backup_<дата>`, правит активный профиль
(`basic.ini`, `recordEncoder.json`) и коллекцию сцен, кладёт `teleprompter.html` на Рабочий стол,
запускает OBS и открывает суфлер в окне 520x260. Отчёт: `backup_<дата>\report.txt`.

Параметры: `run-setup.bat -RecEncoder obs_nvenc_h264_tex -RecFormat mp4 -NoLaunch`

Откат: закройте OBS и верните папки `profiles` и `scenes` из бэкапа в `%APPDATA%\obs-studio\basic`.

Суфлер: Пробел — старт/пауза, ↑/↓ — скорость (Shift — шагом 20), +/− — шрифт, E — вставить текст,
M — зеркало, Home — в начало. Текст и настройки запоминаются.
