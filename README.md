# 🎹 Sky Auto Piano

<img src="./icon/Icon9.ico" alt="Sky Auto Piano Icon" width="100" height="100" align="right"/>

<img alt="Static Badge" src="https://img.shields.io/badge/platform-Windows-Green"> <img alt="GitHub package.json version" src="https://img.shields.io/github/package-json/v/HerokeyVN/Sky-Auto-Piano"> <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/HerokeyVN/Sky-Auto-Piano/total"> <img alt="GitHub License" src="https://img.shields.io/github/license/HerokeyVN/Sky-Auto-Piano">
<br> <br>

## 📖 Introduction

Sky Auto Piano is an automatic music playing software for the game Sky. It allows players to enjoy music without having to manually control the keyboard.

## ✨ Features

- 🎵 Automatic playback of music sheets
- 🎻 Long-press mode helps play instruments like violin, Aurora vocals, etc
- 🎚️ Adjustable playback speed
- 🔆 Light and dark themes
- ⌨️ Global keyboard shortcuts

## 🚀 Installation

1. Download the installation file from [releases](https://github.com/HerokeyVN/Sky-Auto-Piano/releases/).
2. Open the file and follow the instructions to install.

📹 Instructional video: [Watch Tutorial](https://youtu.be/OUjYHQyiGhs)

## 🔧 Building from Source

To build Sky Auto Piano from source:

1. **Prerequisites:**
   - [Node.js](https://nodejs.org/) (version 16 or later)
   - [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

2. **Clone the repository:**
   ```bash
   git clone https://github.com/HerokeyVN/Sky-Auto-Piano.git
   cd Sky-Auto-Piano
   ```

3. **Install dependencies:**
   ```bash
   npm install
   # or
   yarn install
   ```

4. **Build the application:**
   ```bash
   npm run build
   # or
   yarn build
   ```

The packaged application will be available in the `SkyAutoPiano-win32-x64` directory.

## 🧱 Project Structure

The codebase follows a layered Electron architecture:

- `src/main` – Application entry (`app.js`), window management, IPC wiring, and background services.
- `src/common` – Shared Node utilities (filesystem, archive, download helpers).
- `src/renderer` – MVVM renderer with HTML views, viewmodels, and static assets.
- `data` – User sheet data persisted at runtime (created automatically if missing).

This separation keeps main-process logic, shared helpers, and renderer UI concerns isolated for easier maintenance.

## 🧪 Testing

To test the application:

1. **Run in development mode:**
   ```bash
   npm run start
   # or
   yarn start
   ```

2. **Run tests:**
   ```bash
   npm test
   # or
   yarn test
   ```

3. **Manual testing:**
   - Test sheet import functionality with various file formats
   - Verify keyboard shortcuts are working correctly
   - Check theme switching between light and dark modes
   - Test playback features including loop modes and speed adjustment

## 👥 Contributing

Contributions are welcome! Here's how you can contribute:

1. **Fork the repository**
2. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
4. **Commit your changes:**
   ```bash
   git commit -m "Add your meaningful commit message"
   ```
5. **Push to your branch:**
   ```bash
   git push origin feature/your-feature-name
   ```
6. **Open a pull request**

Please ensure your code follows the project's coding style and includes appropriate tests.

## 🐛 Bug Reporting

Found a bug? Please report it by:
1. Opening an issue on GitHub
2. Including detailed steps to reproduce the bug
3. Describing the expected behavior
4. Including screenshots if applicable

## 💬 Support

If you encounter any issues or have questions, please contact me via email: herokey2018@gmail.com

## 📜 License

This software is distributed under the MIT license. See the LICENSE file for more details.

## 🙏 Acknowledgements

Thanks to all contributors and users of Sky Auto Piano who have helped improve this software.
