import {
  Builder,
  By,
  ThenableWebDriver,
  WebElement,
  until,
} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome";
import { ENVIRONMENT } from "../env";

const waitForElement = async (
  driver: ThenableWebDriver,
  by: By,
  webElement?: WebElement,
  timeout: number = 1000
): Promise<WebElement | null> => {
  try {
    await driver.wait(until.elementLocated(by), timeout);
    return (webElement || driver).findElement(by);
    const element = await (webElement || driver).findElement(by);
    driver.executeScript("arguments[0].scrollIntoView(true);", element);
    return element;
  } catch (e) {
    return null;
  }
};

const click = async (element: WebElement | null, attempt = 0) => {
  try {
    if (element && attempt < 3) {
      element.click();
    }
  } catch (e) {
    await driver.sleep(200);
    click(element, ++attempt);
    console.error(e);
  }
};

const randomIntFromInterval = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min) + min);
};

let driver: ThenableWebDriver;

const login = async () => {
  (
    await waitForElement(driver, By.id("login-comp-input"), undefined, 500)
  )?.sendKeys(ENVIRONMENT.companyNumber);
  (await waitForElement(driver, By.id("login-name-input")))?.sendKeys(
    ENVIRONMENT.username
  );
  (await waitForElement(driver, By.id("login-pw-input")))?.sendKeys(
    ENVIRONMENT.password
  );
  await click(await waitForElement(driver, By.css('button[type="submit"]')));
  await driver.sleep(1000);
};

const fillAttendance = async () => {
  await driver.executeScript("window.updateAttendance()");

  const tdText = "חסרה כניסה/יציאה";
  const approveText = `עדכן`;
  const holidayEveText = "ערב חג";

  let element: WebElement | null;
  let isHolidayEve: boolean = false;

  while (
    !!(element = await waitForElement(
      driver,
      By.xpath(`//td[text()='${tdText}']`)
    ))
  ) {
    click(element);

    try {
      isHolidayEve = !!(await element.findElement(
        By.xpath(`preceding-sibling::td[text()='${holidayEveText}']`)
      ));
    } catch {
      isHolidayEve = false;
    }

    const startMinutes = randomIntFromInterval(0, 60);
    const startHour = randomIntFromInterval(
      ENVIRONMENT.startHourRange.min,
      ENVIRONMENT.startHourRange.max
    );
    const endMinutes = Math.max(
      randomIntFromInterval(
        Math.max(0, startMinutes - 15),
        Math.min(60, startMinutes + 15)
      )
    );
    const modal = await waitForElement(
      driver,
      By.css("div.modal.modal-styled.fade.in")
    );

    if (!modal) {
      continue;
    }

    (await waitForElement(driver, By.id("ehh0"), modal))?.sendKeys(startHour);
    await driver.sleep(500);

    (await waitForElement(driver, By.id("emm0"), modal))?.sendKeys(
      startMinutes
    );
    await driver.sleep(500);

    (await waitForElement(driver, By.id("xhh0"), modal))?.sendKeys(
      startHour + (isHolidayEve ? 5 : 9)
    );
    await driver.sleep(500);

    (await waitForElement(driver, By.id("xmm0"), modal))?.sendKeys(endMinutes);
    await driver.sleep(500);

    await click((
      await waitForElement(
        driver,
        By.xpath(`//button[text()='${approveText}']`)
      )
    ));
    await driver.sleep(1500);
  }
};

(async () => {
  const chromeOptions = new chrome.Options();
  chromeOptions.addArguments("--lang=en", "--start-maximized");
  driver = new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions)
    .build();

  try {
    await driver.get("https://c.timewatch.co.il/punch/punch.php");

    await driver.wait(async () => {
      const readyState = await driver.executeScript(
        "return document.readyState"
      );
      return readyState === "complete";
    }, 10000);

    await login();
    await fillAttendance();

    await driver.sleep(5000);
  } catch (e) {
    console.error(e);
  } finally {
    await driver.quit();
  }
})();
