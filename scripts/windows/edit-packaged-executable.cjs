const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

module.exports = async function editPackagedExecutable(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const projectRoot = path.resolve(__dirname, "..", "..");
  const packageJson = require(path.join(projectRoot, "package.json"));
  const executableName = packageJson.build?.win?.executableName || packageJson.build?.productName;
  const executablePath = path.join(context.appOutDir, `${executableName}.exe`);
  const resourceEditor = path.join(
    projectRoot,
    "node_modules",
    "electron-winstaller",
    "vendor",
    "rcedit.exe"
  );
  const version = `${packageJson.version}.0`;

  await execFileAsync(resourceEditor, [
    executablePath,
    "--set-version-string", "CompanyName", packageJson.author || "mac20777",
    "--set-version-string", "FileDescription", packageJson.build.productName,
    "--set-version-string", "ProductName", packageJson.build.productName,
    "--set-version-string", "InternalName", executableName,
    "--set-version-string", "OriginalFilename", `${executableName}.exe`,
    "--set-version-string", "LegalCopyright", packageJson.build.copyright || "",
    "--set-file-version", version,
    "--set-product-version", version
  ], {
    cwd: projectRoot,
    windowsHide: true
  });
};
