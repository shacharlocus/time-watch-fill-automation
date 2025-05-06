import {
  Builder,
  By,
  ThenableWebDriver,
  WebElement,
  until,
} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome";
import { ENVIRONMENT } from "../env";
import { VACATIONS, SICK_DAYS, DateRange } from "./timefill.config";

const MISSING = "חסרה כניסה/יציאה";
const UPDATE = "עדכן";
const HOLIDAY_EVE = "ערב חג";
const SICK = "מחלה";
const VACATION = "חופש";

function getWeekdaysInRange({ start, end }: DateRange): string[] {
  const dates: string[] = [];
  for (
    let d = new Date(start);
    d <= new Date(end);
    d.setDate(d.getDate() + 1)
  ) {
    const day = d.getDay(); // 0=Sun, 1=Mon … 5=Fri, 6=Sat
    if (day !== 5 && day !== 6) {
      // keep Sun–Thu, skip Fri & Sat
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

const vacationDates = new Set(VACATIONS.flatMap((r) => getWeekdaysInRange(r)));
const sickDates = new Set(SICK_DAYS.flatMap((r) => getWeekdaysInRange(r)));

const waitForElement = async (
  driver: ThenableWebDriver,
  by: By,
  root?: WebElement,
  timeout: number = 1000
): Promise<WebElement | null> => {
  try {
    await driver.wait(until.elementLocated(by), timeout);
    return (root || driver).findElement(by);
    const element = await (root || driver).findElement(by);
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

/**
 * Opens the "סיבת העדכון" dropdown in the given modal and
 * clicks the <li> whose text === reasonText.
 */
async function selectReason(
  modal: WebElement,
  reasonText: string
): Promise<void> {
  // 1) open the Select2 dropdown
  const toggle = await waitForElement(
    driver,
    By.xpath(".//span[contains(@class,'select2-selection--single')]"),
    modal,
    1000
  );
  if (!toggle) throw new Error("Could not find reason-dropdown toggle");
  await click(toggle);

  // 2) wait for the <ul class="select2-results__options"> to show up & be visible
  const list = await waitForElement(
    driver,
    By.xpath(
      "//ul[contains(@class,'select2-results__options') and not(@aria-hidden='true')]"
    ),
    undefined,
    1000
  );
  if (!list) throw new Error("Dropdown options list never appeared");

  // 3) pick the <li> whose text exactly matches reasonText
  const options = await list.findElements(By.tagName("li"));
  for (const opt of options) {
    const txt = await opt.getText();
    if (txt.trim() === reasonText) {
      await click(opt);
      await driver.sleep(500);
      return;
    }
  }

  throw new Error(`Dropdown option "${reasonText}" not found`);
}

async function getModalElement() {
  const modal = await waitForElement(
    driver,
    By.css("div.modal.modal-styled.fade.in"),
    undefined,
    1000
  );
  if (!modal) return null;
  return modal;
}

async function fillAttendance() {
  // Kick off attendance update process
  await driver.executeScript("window.updateAttendance()");

  let rowEl: WebElement | null;
  let tries = 0;
  const MAX_TRIES = 100;

  while (tries < MAX_TRIES) {
    rowEl = await waitForElement(
      driver,
      By.xpath(`//td[text()='${MISSING}']`),
      undefined,
      500
    );
    if (!rowEl) break;

    const dateCell = await rowEl.findElement(By.xpath("../td[1]"));

    // --- 1) read and parse the date cell into yyyy-mm-dd ---
    const raw = await dateCell.getText(); // e.g. "א 13-05-2025"

    const [dmY] = raw.split(" ");
    const [dd, MM, YYYY] = dmY.split("-");
    const isoDate = `${YYYY}-${MM}-${dd}`;

    await click(rowEl);
    tries++;

    // Detect holiday eve
    let isHolidayEve = false;
    try {
      await rowEl.findElement(
        By.xpath(`preceding-sibling::td[text()='${HOLIDAY_EVE}']`)
      );
      isHolidayEve = true;
    } catch {
      // not a holiday eve
    }

    // Wait for modal
    const modal = await getModalElement();
    if (!modal) continue;
    
    if (vacationDates.has(isoDate)) {
      // choose “חופש”
      await selectReason(modal, VACATION);
    } else if (sickDates.has(isoDate)) {
      // choose “מחלה”
      await selectReason(modal, SICK);
    } else {
      // --- 3) otherwise do your normal time-entry in the modal ---
      // Generate random times
      const startHour = randomIntFromInterval(
        ENVIRONMENT.startHourRange.min,
        ENVIRONMENT.startHourRange.max
      );
      const startMin = randomIntFromInterval(0, 59);
      const endHour = startHour + (isHolidayEve ? 5 : 9);
      const endMin = Math.max(
        0,
        Math.min(59, startMin + randomIntFromInterval(-15, 15))
      );

      // Fill inputs
      const inputs = [
        { id: "ehh0", value: startHour },
        { id: "emm0", value: startMin },
        { id: "xhh0", value: endHour },
        { id: "xmm0", value: endMin },
      ];

      for (const { id, value } of inputs) {
        const input = await waitForElement(driver, By.id(id), modal, 500);
        if (input) {
          await input.clear();
          await input.sendKeys(value.toString());
          await driver.sleep(300);
        }
      }
    }

    // Submit
    clickOnUpdate();
    await driver.sleep(1200);
  }

  if (tries >= MAX_TRIES) {
    console.warn(
      "Reached maximum fill attempts, stopping to avoid infinite loop."
    );
  }
}

async function clickOnUpdate() {
  const updateBtn = await waitForElement(
    driver,
    By.xpath(`//button[text()='${UPDATE}']`),
    undefined,
    500
  );
  if (updateBtn) {
    await click(updateBtn);
  }
}

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
