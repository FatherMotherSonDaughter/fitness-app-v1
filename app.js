const STORAGE_KEY = "forgeFitnessProfiles";
const LEGACY_STORAGE_KEY = "forgeFitnessData";
const BACKUP_STATUS_KEY = "forgeFitnessLastBackupAt";
const SAVE_STATUS_KEY = "forgeFitnessLastSavedAt";

window.FORGE_APP_LOADED = true;

const today = () => {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
};

const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function normalizeDateValue(value, fallback = today()) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const localDate = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
  }
  return fallback;
}

const workoutPlan = [
  {
    day: "Monday",
    title: "Push",
    items: [
      ["Cable Fly", "3 x 10", "17.5 lb"],
      ["Dips", "3 x 12", "Bodyweight"],
      ["Bench Press", "3 x 10, 45 deg incline", "Barbell + 50 lb plate"],
      ["Dumbbell Fly", "3 x 15, 30 deg incline", "25 lb"],
      ["Dumbbell Shoulder Press", "3 x 10, 60 deg incline", "45 lb"],
      ["Katana Tricep Extension", "3 x 10", "27.5 lb"]
    ]
  },
  {
    day: "Tuesday",
    title: "Pull",
    items: [
      ["Lat Pulldown", "3 x 10", "190 lb"],
      ["Bent Over Row", "3 x 10, chest supported", "Barbell + 55 lb plate"],
      ["Lat Pullover", "3 x 10", "72.5 lb"],
      ["Rear Delt Flies", "2 x 15", "17.5 lb"]
    ]
  },
  {
    day: "Wednesday",
    title: "Leg",
    items: [
      ["RDL", "3 x 6-8", "40 lb each dumbbell / bar + 90 lb"],
      ["Squat", "2 x 6-8", "Bar + 75 lb"],
      ["Bulgarian Split Squat", "Sets not set", "50 lb dumbbell"],
      ["Reverse Nordic Curl", "2 x 6-8", "Bodyweight"]
    ]
  },
  {
    day: "Thursday",
    title: "Cardio",
    items: [["Cardio", "Open session", ""]]
  },
  {
    day: "Friday",
    title: "Push",
    repeat: "Monday"
  },
  {
    day: "Saturday",
    title: "Pull",
    repeat: "Tuesday"
  },
  {
    day: "Sunday",
    title: "Rest",
    items: [["Rest", "Recovery day", ""]]
  },
  {
    day: "Abs / Forearm",
    title: "Accessory",
    items: [
      ["Cable Crunch", "3 x 10", "85 lb"],
      ["Forearm Flexor", "Sets/reps not set", "45 lb"],
      ["Forearm Extensor Cable", "Sets/reps not set", "32.5 lb"],
      ["Hammer Curls", "Sets/reps not set", "30 lb dumbbell"]
    ]
  }
];

const keyLiftOptions = [
  { id: "bench-press", label: "Bench", match: "bench press", color: "#202225" },
  { id: "squat", label: "Squat", match: "squat", color: "#9b9184" },
  { id: "rdl", label: "RDL", match: "rdl", color: "#7e8893" },
  { id: "lat-pulldown", label: "Pulldown", match: "lat pulldown", color: "#6f747a" },
  { id: "shoulder-press", label: "Shoulder", match: "shoulder press", color: "#555b61" }
];

const menuSections = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snacks", label: "Snack" },
  { id: "drinks", label: "Drinks" }
];

const defaultProfileData = {
  settings: {
    calorieGoal: 2310,
    proteinGoal: 170,
    carbGoal: 250,
    fatGoal: 70,
    weightUnit: "lb"
  },
  weights: [],
  lifts: [],
  liftProgress: {},
  liftTimers: {},
  workoutPlan: structuredClone(workoutPlan),
  foods: [],
  completedFoodDays: [],
  meals: [],
  pantryIngredients: "",
  chart: {
    range: "weeks",
    metric: "calories",
    calories: true,
    weight: true,
    lifts: true,
    keyLifts: Object.fromEntries(keyLiftOptions.map((lift) => [lift.id, true]))
  }
};

function macroCalorieGoal(settings = defaultProfileData.settings) {
  const protein = Number(settings.proteinGoal) || defaultProfileData.settings.proteinGoal;
  const carbs = Number(settings.carbGoal) || defaultProfileData.settings.carbGoal;
  const fat = Number(settings.fatGoal) || defaultProfileData.settings.fatGoal;
  return protein * 4 + carbs * 4 + fat * 9;
}

let store = loadStore();
let data = getActiveProfile().data;
let selectedFoodDate = today();
let dateStripCenterDate = selectedFoodDate;
let dateStripShouldCenter = true;
let dateStripDragSuppressUntil = 0;
let dateStripProgrammaticUntil = 0;
const dateStripScrollTimers = new WeakMap();
let lastKnownDate = today();
let editingLiftId = null;
let editingMealId = null;
let editingWorkoutPlan = false;
let editingWorkoutPlanBackup = null;
let quickMealPickerOpen = false;
let selectedMealCategory = "all";
let selectedFoodLogCategory = "all";
let pendingMealPhoto = "";
let mealIngredientDraft = [];
let customFoodDraftNutrition = null;
let barcodeScanState = { mode: "ingredient", row: null, index: null, stream: null, frame: 0, detector: null };
const LIFT_REST_GOAL_MS = 90 * 1000;
const DEFAULT_REST_SECONDS = 90;
let liftTimer = { mode: "ready", startedAt: 0, currentSetStartedAt: 0, exerciseIndex: 0, setIndex: 1, paused: false, pausedAt: 0 };
let liftTimerInterval = 0;
let calendarViewDate = selectedFoodDate;
let calendarSwipe = { x: 0, y: 0, active: false };
let modalLockCount = 0;
let modalScrollY = 0;
let stableViewportTap = null;

const els = {
  screenTitle: document.querySelector("#screenTitle"),
  profileButton: document.querySelector("#profileButton"),
  profileInitials: document.querySelector("#profileInitials"),
  profileSheet: document.querySelector("#profileSheet"),
  profileCloseButton: document.querySelector("#profileCloseButton"),
  profileList: document.querySelector("#profileList"),
  profileForm: document.querySelector("#profileForm"),
  tabs: document.querySelectorAll(".tab"),
  screens: document.querySelectorAll(".screen"),
  toast: document.querySelector("#toast"),
  calorieSummaryButton: document.querySelector("#calorieSummaryButton"),
  weightSummaryButton: document.querySelector("#weightSummaryButton"),
  liftSummaryButton: document.querySelector("#liftSummaryButton"),
  streakSummaryButton: document.querySelector("#streakSummaryButton"),
  currentStreak: document.querySelector("#currentStreak"),
  streakDetail: document.querySelector("#streakDetail"),
  phoneReadyStatus: document.querySelector("#phoneReadyStatus"),
  installStatus: document.querySelector("#installStatus"),
  phoneLinkStatus: document.querySelector("#phoneLinkStatus"),
  backupStatus: document.querySelector("#backupStatus"),
  backupDetail: document.querySelector("#backupDetail"),
  lastSavedStatus: document.querySelector("#lastSavedStatus"),
  settingsStreak: document.querySelector("#settingsStreak"),
  weightForm: document.querySelector("#weightForm"),
  addWeightButton: document.querySelector("#addWeightButton"),
  liftForm: document.querySelector("#liftForm"),
  mealForm: document.querySelector("#mealForm"),
  mealSheet: document.querySelector("#mealSheet"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsGoalButton: document.querySelector("#settingsGoalButton"),
  settingsGoalSummary: document.querySelector("#settingsGoalSummary"),
  settingsGoalSheet: document.querySelector("#settingsGoalSheet"),
  settingsGoalPanel: document.querySelector(".settings-goal-sheet"),
  settingsGoalClose: document.querySelector("#settingsGoalClose"),
  clearButton: document.querySelector("#clearButton"),
  exportDataButton: document.querySelector("#exportDataButton"),
  importDataInput: document.querySelector("#importDataInput"),
  progressChart: document.querySelector("#progressChart"),
  progressLegend: document.querySelector("#progressLegend"),
  calorieRing: document.querySelector("#calorieRing"),
  mealSearch: document.querySelector("#mealSearch"),
  liveDateTime: document.querySelector("#liveDateTime"),
  foodDayStrip: document.querySelector("#foodDayStrip"),
  foodDayTrack: document.querySelector("#foodDayTrack"),
  dateSwitchers: document.querySelectorAll("[data-date-switcher]"),
  weightDaySummary: document.querySelector("#weightDaySummary"),
  liftDaySummary: document.querySelector("#liftDaySummary"),
  liftTimerCard: document.querySelector("#liftTimerCard"),
  liftTimerMode: document.querySelector("#liftTimerMode"),
  liftTimerDisplay: document.querySelector("#liftTimerDisplay"),
  liftTimerHint: document.querySelector("#liftTimerHint"),
  liftTimerExercise: document.querySelector("#liftTimerExercise"),
  liftTimerProgress: document.querySelector("#liftTimerProgress"),
  liftTimerTap: document.querySelector("#liftTimerTap"),
  liftTimerReset: document.querySelector("#liftTimerReset"),
  liftTimerPrevious: document.querySelector("#liftTimerPrevious"),
  liftTimerPause: document.querySelector("#liftTimerPause"),
  liftTimerSkip: document.querySelector("#liftTimerSkip"),
  liftTimerCount: document.querySelector("#liftTimerCount"),
  liftTimerHistory: document.querySelector("#liftTimerHistory"),
  foodWeekLabel: document.querySelector("#foodWeekLabel"),
  foodDatePicker: document.querySelector("#foodDatePicker"),
  nutritionDashboardPanel: document.querySelector(".nutrition-dashboard-panel"),
  calendarJumpButton: document.querySelector("#calendarJumpButton"),
  calendarSheet: document.querySelector("#calendarSheet"),
  calendarSheetPanel: document.querySelector(".calendar-sheet"),
  calendarSheetTitle: document.querySelector("#calendarSheetTitle"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarPrevMonth: document.querySelector("#calendarPrevMonth"),
  calendarNextMonth: document.querySelector("#calendarNextMonth"),
  calendarTodayButton: document.querySelector("#calendarTodayButton"),
  calendarCloseButton: document.querySelector("#calendarCloseButton"),
  previousFoodWeek: document.querySelector("#previousFoodWeek"),
  nextFoodWeek: document.querySelector("#nextFoodWeek"),
  todayFoodButton: document.querySelector("#todayFoodButton"),
  nutritionTrendChart: document.querySelector("#nutritionTrendChart"),
  nutritionTrendTitle: document.querySelector("#nutritionTrendTitle"),
  nutritionTrendValue: document.querySelector("#nutritionTrendValue"),
  nutritionTrendGoal: document.querySelector("#nutritionTrendGoal"),
  savedMenuSearch: document.querySelector("#savedMenuSearch"),
  logFoodButton: document.querySelector("#logFoodButton"),
  logFoodActions: document.querySelector("#logFoodActions"),
  addMenuButton: document.querySelector("#addMenuButton"),
  quickMealPicker: document.querySelector("#quickMealPicker"),
  foodLogSheet: document.querySelector("#foodLogSheet"),
  foodLogSheetPanel: document.querySelector(".food-log-sheet"),
  foodLogSheetClose: document.querySelector("#foodLogSheetClose"),
  foodLogMenuSearch: document.querySelector("#foodLogMenuSearch"),
  foodLogMenuList: document.querySelector("#foodLogMenuList"),
  foodLogMenuCount: document.querySelector("#foodLogMenuCount"),
  foodLogCategoryFilters: document.querySelector("#foodLogCategoryFilters"),
  customFoodName: document.querySelector("#customFoodName"),
  customFoodBarcode: document.querySelector("#customFoodBarcode"),
  customFoodBarcodePhoto: document.querySelector("#customFoodBarcodePhoto"),
  customFoodScanBarcode: document.querySelector("#customFoodScanBarcode"),
  customFoodBarcodeLookup: document.querySelector("#customFoodBarcodeLookup"),
  customFoodCalories: document.querySelector("#customFoodCalories"),
  customFoodCalculatedCalories: document.querySelector("#customFoodCalculatedCalories"),
  customFoodProtein: document.querySelector("#customFoodProtein"),
  customFoodCarbs: document.querySelector("#customFoodCarbs"),
  customFoodFat: document.querySelector("#customFoodFat"),
  logCustomFoodButton: document.querySelector("#logCustomFoodButton"),
  fridgeAddMenuButton: document.querySelector("#fridgeAddMenuButton"),
  fridgePanel: document.querySelector("#fridgePanel"),
  mealLibraryCount: document.querySelector("#mealLibraryCount"),
  mealCategoryFilters: document.querySelector("#mealCategoryFilters"),
  mealPhoto: document.querySelector("#mealPhoto"),
  mealPhotoPreview: document.querySelector("#mealPhotoPreview"),
  mealCategory: document.querySelector("#mealCategory"),
  ingredientList: document.querySelector("#ingredientList"),
  addIngredientButton: document.querySelector("#addIngredientButton"),
  saveMealButton: document.querySelector("#saveMealButton"),
  mealTotals: document.querySelector("#mealTotals"),
  barcodeScanner: document.querySelector("#barcodeScanner"),
  barcodeVideo: document.querySelector("#barcodeVideo"),
  scannerBarcodeInput: document.querySelector("#scannerBarcodeInput"),
  scannerLookupButton: document.querySelector("#scannerLookupButton"),
  scannerPhotoButton: document.querySelector("#scannerPhotoButton"),
  barcodeScannerClose: document.querySelector("#barcodeScannerClose"),
  pantryInput: document.querySelector("#pantryInput"),
  rangeControls: document.querySelector("#rangeControls"),
  metricControls: document.querySelectorAll("[data-chart-metric]"),
  liftKeyToggles: document.querySelector("#liftKeyToggles")
};

function cloneProfileData() {
  return structuredClone(defaultProfileData);
}

function normalizeProfileData(profileData = {}) {
  return {
    ...cloneProfileData(),
    ...profileData,
    settings: {
      ...defaultProfileData.settings,
      ...(profileData.settings || {}),
      calorieGoal: Number(profileData.settings?.calorieGoal) || defaultProfileData.settings.calorieGoal
    },
    chart: {
      ...defaultProfileData.chart,
      ...(profileData.chart || {}),
      range: ["weeks", "months", "years"].includes(profileData.chart?.range) ? profileData.chart.range : "weeks",
      metric: ["calories", "weight", "lifts"].includes(profileData.chart?.metric) ? profileData.chart.metric : "calories",
      keyLifts: {
        ...defaultProfileData.chart.keyLifts,
        ...((profileData.chart || {}).keyLifts || {})
      }
    },
    weights: Array.isArray(profileData.weights)
      ? profileData.weights.map((entry) => ({
        ...entry,
        id: entry.id || uid(),
        date: normalizeDateValue(entry.date),
        value: Number(entry.value) || 0
      })).filter((entry) => entry.value > 0)
      : [],
    lifts: Array.isArray(profileData.lifts)
      ? profileData.lifts.map((lift) => ({
        ...lift,
        id: lift.id || uid(),
        date: normalizeDateValue(lift.date),
        exercise: lift.exercise || "Lift",
        sets: Number(lift.sets) || 0,
        reps: Number(lift.reps) || 0,
        weight: Number(lift.weight) || 0,
        progressWeight: Number(lift.progressWeight ?? lift.weight) || 0
      }))
      : [],
    liftProgress: profileData.liftProgress && typeof profileData.liftProgress === "object" ? profileData.liftProgress : {},
    liftTimers: profileData.liftTimers && typeof profileData.liftTimers === "object" ? profileData.liftTimers : {},
    workoutPlan: Array.isArray(profileData.workoutPlan) ? profileData.workoutPlan : structuredClone(workoutPlan),
    foods: Array.isArray(profileData.foods) ? profileData.foods.map(normalizeFoodLog) : [],
    completedFoodDays: Array.isArray(profileData.completedFoodDays) ? profileData.completedFoodDays.map((date) => normalizeDateValue(date)) : [],
    meals: Array.isArray(profileData.meals) ? profileData.meals.map(normalizeMeal) : [],
    pantryIngredients: profileData.pantryIngredients || ""
  };
}

function normalizeMeal(meal = {}) {
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients.map(normalizeIngredient) : [];
  const totals = mealTotals(ingredients);
  const category = menuSections.some((section) => section.id === meal.category) ? meal.category : "lunch";
  return {
    ...meal,
    category,
    ingredients,
    calories: Number(meal.calories ?? totals.calories) || totals.calories,
    protein: Number(meal.protein ?? totals.protein) || totals.protein,
    carbs: Number(meal.carbs ?? totals.carbs) || totals.carbs,
    fat: Number(meal.fat ?? totals.fat) || totals.fat,
    fiber: Number(meal.fiber ?? totals.fiber) || totals.fiber,
    sugar: Number(meal.sugar ?? totals.sugar) || totals.sugar,
    sodium: Number(meal.sodium ?? totals.sodium) || totals.sodium,
    potassium: Number(meal.potassium ?? totals.potassium) || totals.potassium
  };
}

function normalizeFoodLog(food = {}) {
  const baseNutrition = food.baseNutrition || nutritionFromItem(food);
  return applyFoodPortion({
    id: food.id || uid(),
    date: normalizeDateValue(food.date),
    createdAt: food.createdAt || new Date().toISOString(),
    source: food.source || (food.mealId ? "saved-menu" : "custom"),
    name: food.name || "Food",
    calories: Number(food.calories) || 0,
    protein: Number(food.protein) || 0,
    carbs: Number(food.carbs) || 0,
    fat: Number(food.fat) || 0,
    fiber: Number(food.fiber) || 0,
    sugar: Number(food.sugar) || 0,
    sodium: Number(food.sodium) || 0,
    potassium: Number(food.potassium) || 0,
    baseNutrition,
    baseServingAmount: Number(food.baseServingAmount) || 0,
    baseServingUnit: food.baseServingUnit || "",
    servingMode: food.servingMode || "serving",
    servingCount: Number(food.servingCount) || 1,
    weightAmount: Number(food.weightAmount) || 0,
    weightUnit: food.weightUnit || food.baseServingUnit || "g",
    ingredients: Array.isArray(food.ingredients) ? food.ingredients.map(normalizeIngredient) : [],
    mealId: food.mealId || "",
    photo: food.photo || ""
  });
}

function createFoodLogFromMeal(meal) {
  const basePortion = mealBasePortion(meal);
  return normalizeFoodLog({
    date: selectedFoodDate,
    source: "saved-menu",
    name: meal.name,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    fiber: meal.fiber || 0,
    sugar: meal.sugar || 0,
    sodium: meal.sodium || 0,
    potassium: meal.potassium || 0,
    baseNutrition: nutritionFromItem(meal),
    baseServingAmount: basePortion.amount,
    baseServingUnit: basePortion.unit,
    servingMode: "serving",
    servingCount: 1,
    weightAmount: basePortion.amount,
    weightUnit: basePortion.unit || "g",
    ingredients: Array.isArray(meal.ingredients) ? structuredClone(meal.ingredients) : [],
    mealId: meal.id,
    photo: meal.photo || ""
  });
}

function createProfile(name, profileData) {
  return {
    id: uid(),
    name,
    data: normalizeProfileData(profileData)
  };
}

function loadStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.profiles?.length) {
      return {
        activeProfileId: stored.activeProfileId || stored.profiles[0].id,
        profiles: stored.profiles.map((profile) => ({
          id: profile.id || uid(),
          name: profile.name || "Me",
          data: normalizeProfileData(profile.data)
        }))
      };
    }
  } catch {
    // Legacy migration below.
  }

  try {
    const legacyData = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    const profile = createProfile("Me", legacyData);
    return { activeProfileId: profile.id, profiles: [profile] };
  } catch {
    const profile = createProfile("Me", cloneProfileData());
    return { activeProfileId: profile.id, profiles: [profile] };
  }
}

function getActiveProfile() {
  return store.profiles.find((profile) => profile.id === store.activeProfileId) || store.profiles[0];
}

function saveStore() {
  data = getActiveProfile().data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  localStorage.setItem(SAVE_STATUS_KEY, new Date().toISOString());
}

function saveData() {
  saveStore();
  render();
}

function initials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "ME";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 1900);
}

function lockBackgroundScroll() {
  modalLockCount += 1;
  if (modalLockCount > 1) return;
  modalScrollY = window.scrollY || 0;
  document.body.style.top = `-${modalScrollY}px`;
  document.body.classList.add("modal-open");
}

function unlockBackgroundScroll() {
  modalLockCount = Math.max(0, modalLockCount - 1);
  if (modalLockCount) return;
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  window.scrollTo(0, modalScrollY);
}

function shouldPreserveViewport(target) {
  const interactive = target.closest(
    "button, .meal-row, .quick-meal-row, .food-log-menu-row, .day-square, .date-card, .toggle-pill, .calendar-day, .macro-card, .micro-panel"
  );
  if (!interactive) return false;
  return !target.closest(
    [
      ".tab",
      "[data-screen]",
      "#todayFoodButton",
      "[data-date-action='today']",
      "#calendarTodayButton",
      "#logFoodButton",
      "#addMenuButton",
      "#fridgeAddMenuButton",
      "#profileButton",
      "#calendarJumpButton",
      "[data-date-action='calendar']",
      ".sheet-close",
      "#cancelMealEdit",
      "#foodLogSheetClose",
      "#profileCloseButton",
      "#barcodeScannerClose"
    ].join(",")
  );
}

function restoreStableViewport(snapshot) {
  if (!snapshot || document.body.classList.contains("modal-open")) return;
  const restore = () => {
    if (document.body.classList.contains("modal-open")) return;
    window.scrollTo(snapshot.x, snapshot.y);
  };
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
}

function bindStableViewportInteractions() {
  document.addEventListener("pointerdown", (event) => {
    stableViewportTap = shouldPreserveViewport(event.target)
      ? { x: window.scrollX || 0, y: window.scrollY || 0 }
      : null;
  }, true);
  document.addEventListener("click", (event) => {
    const snapshot = stableViewportTap;
    stableViewportTap = null;
    if (!snapshot || !shouldPreserveViewport(event.target)) return;
    restoreStableViewport(snapshot);
  }, true);
}

function setDefaultDates() {
  ["weightDate", "liftDate", "dietDate"].forEach((id) => {
    const input = document.querySelector(`#${id}`);
    if (input) input.value = today();
  });
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekStart(value) {
  const date = new Date(`${value}T12:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  return date.toISOString().slice(0, 10);
}

function formatFoodDay(value) {
  const label = value === today() ? "Today" : new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(`${value}T12:00:00`));
  return label;
}

function monthKey(value) {
  return String(value || today()).slice(0, 7);
}

function addMonths(value, amount) {
  const date = new Date(`${monthKey(value)}-01T12:00:00`);
  date.setMonth(date.getMonth() + amount);
  return date.toISOString().slice(0, 10);
}

function monthLabel(value) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(`${monthKey(value)}-01T12:00:00`));
}

function daySnapshot(date) {
  const targetDate = normalizeDateValue(date);
  const totals = foodTotals(date);
  const foodCount = data.foods.filter((food) => normalizeDateValue(food.date, "") === targetDate).length;
  const liftCount = data.lifts.filter((lift) => normalizeDateValue(lift.date, "") === targetDate).length;
  const weight = sortedByDate(data.weights.filter((entry) => normalizeDateValue(entry.date, "") === targetDate))[0];
  return { totals, foodCount, liftCount, weight };
}

function hasDayActivity(date) {
  const snapshot = daySnapshot(date);
  return Boolean(snapshot.foodCount || snapshot.liftCount || snapshot.weight);
}

function dayNameForDate(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(`${date}T12:00:00`));
}

function workoutForDate(date) {
  const dayName = dayNameForDate(date);
  return activeWorkoutPlan().find((day) => day.day === dayName);
}

function number(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDurationMs(ms) {
  const value = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((value % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function sortedByDate(items) {
  return [...items].sort((a, b) => b.date.localeCompare(a.date));
}

function loggedDateSet() {
  return new Set([
    ...data.foods.map((food) => normalizeDateValue(food.date, "")),
    ...data.weights.map((weight) => normalizeDateValue(weight.date, "")),
    ...data.lifts.map((lift) => normalizeDateValue(lift.date, ""))
  ].filter(Boolean));
}

function currentStreakInfo() {
  const dates = loggedDateSet();
  let cursor = today();
  if (!dates.has(cursor)) {
    const yesterday = addDays(cursor, -1);
    if (!dates.has(yesterday)) return { count: 0, activeToday: false };
    cursor = yesterday;
  }
  const activeToday = cursor === today();
  let count = 0;
  while (dates.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return { count, activeToday };
}

function parseIngredients(value) {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeIngredient(ingredient) {
  const baseNutrition = ingredient.baseNutrition || null;
  const parsedServing = parseServingAmount(ingredient.servingSize);
  const servingMode = ingredient.servingMode || (parsedServing.unit ? "weight" : "serving");
  const weightUnit = ingredient.weightUnit || parsedServing.unit || ingredient.baseServingUnit || "g";
  if (typeof ingredient === "string") {
    return { id: uid(), name: ingredient, servingSize: "", servingMode: "serving", servingCount: 1, weightAmount: 0, weightUnit: "g", barcode: "", baseServingSize: "", baseServingAmount: 0, baseServingUnit: "", baseNutrition: null, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0, potassium: 0, photo: "" };
  }
  return {
    id: ingredient.id || uid(),
    name: ingredient.name || "",
    servingSize: ingredient.servingSize || "",
    servingMode,
    servingCount: Number(ingredient.servingCount) || (servingMode === "serving" ? parsedServing.amount || 1 : 1),
    weightAmount: Number(ingredient.weightAmount) || (servingMode === "weight" ? parsedServing.amount : 0),
    weightUnit,
    barcode: ingredient.barcode || "",
    baseServingSize: ingredient.baseServingSize || "",
    baseServingAmount: Number(ingredient.baseServingAmount) || 0,
    baseServingUnit: ingredient.baseServingUnit || "",
    baseNutrition: baseNutrition
      ? {
          calories: Number(baseNutrition.calories) || 0,
          protein: Number(baseNutrition.protein) || 0,
          carbs: Number(baseNutrition.carbs) || 0,
          fat: Number(baseNutrition.fat) || 0,
          fiber: Number(baseNutrition.fiber) || 0,
          sugar: Number(baseNutrition.sugar) || 0,
          sodium: Number(baseNutrition.sodium) || 0,
          potassium: Number(baseNutrition.potassium) || 0
        }
      : null,
    calories: Number(ingredient.calories) || 0,
    protein: Number(ingredient.protein) || 0,
    carbs: Number(ingredient.carbs) || 0,
    fat: Number(ingredient.fat) || 0,
    fiber: Number(ingredient.fiber) || 0,
    sugar: Number(ingredient.sugar) || 0,
    sodium: Number(ingredient.sodium) || 0,
    potassium: Number(ingredient.potassium) || 0,
    photo: ingredient.photo || ""
  };
}

function mealTotals(ingredients) {
  return ingredients.reduce(
    (totals, ingredient) => ({
    calories: totals.calories + (Number(ingredient.calories) || 0),
    protein: totals.protein + (Number(ingredient.protein) || 0),
    carbs: totals.carbs + (Number(ingredient.carbs) || 0),
    fat: totals.fat + (Number(ingredient.fat) || 0),
    fiber: totals.fiber + (Number(ingredient.fiber) || 0),
    sugar: totals.sugar + (Number(ingredient.sugar) || 0),
    sodium: totals.sodium + (Number(ingredient.sodium) || 0),
    potassium: totals.potassium + (Number(ingredient.potassium) || 0)
  }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0, potassium: 0 }
  );
}

function ingredientText(ingredients) {
  return ingredients.map((ingredient) => ingredient.name).filter(Boolean).join(", ");
}

function ingredientNameFromFile(file) {
  return file.name
    .replace(/\.[^.]+$/, "")
    .replace(/img|image|photo|scan|label|\d+/gi, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function setPhotoPreview(container, dataUrl, onRemove) {
  container.innerHTML = "";
  container.hidden = !dataUrl;
  if (!dataUrl) return;
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "";
  const removeButton = document.createElement("button");
  removeButton.className = "remove-photo-button";
  removeButton.type = "button";
  removeButton.textContent = "Remove photo";
  removeButton.addEventListener("click", () => {
    onRemove?.();
    setPhotoPreview(container, "");
  });
  container.append(img, removeButton);
}

function photoThumb(dataUrl) {
  if (!dataUrl) return "";
  return `<img class="row-photo" src="${dataUrl}" alt="" />`;
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onload = () => {
        const maxSize = 900;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function detectBarcodeFromFile(file) {
  if (!("BarcodeDetector" in window)) return "";
  try {
    const detector = new BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
    });
    const bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);
    bitmap.close?.();
    return codes[0]?.rawValue || "";
  } catch {
    return "";
  }
}

function firstNumber(source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function gramsToMilligrams(value) {
  if (!value) return 0;
  return value < 20 ? value * 1000 : value;
}

function parseServingAmount(value) {
  const text = String(value || "").toLowerCase();
  const unitNumberMatch = text.match(/(\d+(?:\.\d+)?)\s*(g|gram|grams|kg|ml|milliliter|milliliters|l|oz|ounce|ounces|lb|pound|pounds)\b/);
  const fallbackNumberMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!unitNumberMatch && !fallbackNumberMatch) return { amount: 0, unit: "" };
  const unit = unitNumberMatch?.[2] || "";
  const unitMap = {
    gram: "g",
    grams: "g",
    kg: "g",
    milliliter: "ml",
    milliliters: "ml",
    l: "ml",
    ounce: "oz",
    ounces: "oz",
    pound: "lb",
    pounds: "lb"
  };
  let amount = Number(unitNumberMatch?.[1] || fallbackNumberMatch?.[1]) || 0;
  const normalizedUnit = unitMap[unit] || unit;
  if (unit === "kg") amount *= 1000;
  if (unit === "l") amount *= 1000;
  return { amount, unit: normalizedUnit };
}

function roundNutrition(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function convertAmount(amount, fromUnit, toUnit) {
  if (!amount || !fromUnit || !toUnit || fromUnit === toUnit) return amount;
  const weightToGrams = { g: 1, oz: 28.3495 };
  const volumeToMilliliters = { ml: 1, oz: 29.5735 };
  if (weightToGrams[fromUnit] && weightToGrams[toUnit]) {
    return (amount * weightToGrams[fromUnit]) / weightToGrams[toUnit];
  }
  if (volumeToMilliliters[fromUnit] && volumeToMilliliters[toUnit]) {
    return (amount * volumeToMilliliters[fromUnit]) / volumeToMilliliters[toUnit];
  }
  return 0;
}

function servingSizeText(ingredient) {
  if (ingredient.servingMode === "weight") {
    const amount = Number(ingredient.weightAmount) || 0;
    return amount ? `${amount}${ingredient.weightUnit || "g"}` : "";
  }
  const count = Number(ingredient.servingCount) || 1;
  return `${count} ${count === 1 ? "serving" : "servings"}`;
}

function baseNutritionFromIngredient(ingredient) {
  return {
    calories: Number(ingredient.calories) || 0,
    protein: Number(ingredient.protein) || 0,
    carbs: Number(ingredient.carbs) || 0,
    fat: Number(ingredient.fat) || 0,
    fiber: Number(ingredient.fiber) || 0,
    sugar: Number(ingredient.sugar) || 0,
    sodium: Number(ingredient.sodium) || 0,
    potassium: Number(ingredient.potassium) || 0
  };
}

function nutritionFromItem(item) {
  return {
    calories: Number(item.calories) || 0,
    protein: Number(item.protein) || 0,
    carbs: Number(item.carbs) || 0,
    fat: Number(item.fat) || 0,
    fiber: Number(item.fiber) || 0,
    sugar: Number(item.sugar) || 0,
    sodium: Number(item.sodium) || 0,
    potassium: Number(item.potassium) || 0
  };
}

function scaledNutrition(baseNutrition, scale) {
  return {
    calories: roundNutrition(baseNutrition.calories * scale),
    protein: roundNutrition(baseNutrition.protein * scale),
    carbs: roundNutrition(baseNutrition.carbs * scale),
    fat: roundNutrition(baseNutrition.fat * scale),
    fiber: roundNutrition(baseNutrition.fiber * scale),
    sugar: roundNutrition(baseNutrition.sugar * scale),
    sodium: Math.round(baseNutrition.sodium * scale),
    potassium: Math.round(baseNutrition.potassium * scale)
  };
}

function scaledIngredientForServing(ingredient) {
  if (!ingredient.baseNutrition) return ingredient;
  let scale = 1;
  if (ingredient.servingMode === "weight") {
    if (!ingredient.baseServingAmount) return ingredient;
    const amount = convertAmount(Number(ingredient.weightAmount) || 0, ingredient.weightUnit, ingredient.baseServingUnit);
    if (!amount) return ingredient;
    scale = amount / ingredient.baseServingAmount;
  } else {
    scale = Number(ingredient.servingCount) || 1;
  }
  return { ...ingredient, servingSize: servingSizeText(ingredient), ...scaledNutrition(ingredient.baseNutrition, scale) };
}

function mealBasePortion(meal) {
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  const totals = ingredients.reduce(
    (result, ingredient) => {
      if (ingredient.servingMode !== "weight") return result;
      const unit = ingredient.weightUnit || ingredient.baseServingUnit || "";
      const amount = Number(ingredient.weightAmount) || parseServingAmount(ingredient.servingSize).amount;
      if (!amount || !unit) return result;
      const targetUnit = result.unit || (unit === "ml" ? "ml" : "g");
      const converted = convertAmount(amount, unit, targetUnit);
      if (!converted) return { ...result, mixed: true };
      return { amount: result.amount + converted, unit: targetUnit, mixed: result.mixed };
    },
    { amount: 0, unit: "", mixed: false }
  );
  return totals.mixed ? { amount: 0, unit: "" } : totals;
}

function applyFoodPortion(food) {
  const baseNutrition = food.baseNutrition || nutritionFromItem(food);
  let scale = Number(food.servingCount) || 1;
  if (food.servingMode === "weight") {
    const converted = convertAmount(Number(food.weightAmount) || 0, food.weightUnit, food.baseServingUnit);
    scale = converted && food.baseServingAmount ? converted / food.baseServingAmount : 1;
  }
  return { ...food, ...scaledNutrition(baseNutrition, scale) };
}

function productNutrition(product, barcode, photo, existing = {}) {
  const nutriments = product.nutriments || {};
  const sodium = firstNumber(nutriments, ["sodium_serving", "sodium_100g"]);
  const potassium = firstNumber(nutriments, ["potassium_serving", "potassium_100g"]);
  const servingSize = product.serving_size || existing.servingSize || "1 serving";
  const serving = parseServingAmount(servingSize);
  const ingredient = normalizeIngredient({
    ...existing,
    name: product.product_name || product.generic_name || existing.name || `Barcode ${barcode}`,
    servingSize,
    barcode,
    calories: firstNumber(nutriments, ["energy-kcal_serving", "energy-kcal_100g"]),
    protein: firstNumber(nutriments, ["proteins_serving", "proteins_100g"]),
    carbs: firstNumber(nutriments, ["carbohydrates_serving", "carbohydrates_100g"]),
    fat: firstNumber(nutriments, ["fat_serving", "fat_100g"]),
    fiber: firstNumber(nutriments, ["fiber_serving", "fiber_100g"]),
    sugar: firstNumber(nutriments, ["sugars_serving", "sugars_100g"]),
    sodium: gramsToMilligrams(sodium),
    potassium: gramsToMilligrams(potassium),
    photo
  });
  return normalizeIngredient({
    ...ingredient,
    servingMode: serving.unit ? "weight" : "serving",
    servingCount: 1,
    weightAmount: serving.amount || 0,
    weightUnit: ["g", "oz", "ml"].includes(serving.unit) ? serving.unit : "g",
    baseServingSize: servingSize,
    baseServingAmount: serving.amount,
    baseServingUnit: serving.unit,
    baseNutrition: baseNutritionFromIngredient(ingredient)
  });
}

async function lookupBarcodeNutrition(barcode) {
  const fields = ["product_name", "generic_name", "serving_size", "nutriments"].join(",");
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`);
  if (!response.ok) throw new Error("Barcode lookup failed.");
  const payload = await response.json();
  if (!payload.product) throw new Error("Barcode not found.");
  return payload.product;
}

function foodTotals(date = today()) {
  const targetDate = normalizeDateValue(date);
  return data.foods
    .filter((food) => normalizeDateValue(food.date, "") === targetDate)
    .reduce(
      (totals, food) => ({
        calories: totals.calories + food.calories,
        protein: totals.protein + food.protein,
        carbs: totals.carbs + food.carbs,
        fat: totals.fat + food.fat,
        fiber: totals.fiber + (food.fiber || 0),
        sugar: totals.sugar + (food.sugar || 0),
        sodium: totals.sodium + (food.sodium || 0),
        potassium: totals.potassium + (food.potassium || 0)
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0, potassium: 0 }
    );
}

function blankNutritionTotals() {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

function addNutritionTotals(target, food) {
  target.calories += Number(food.calories) || 0;
  target.protein += Number(food.protein) || 0;
  target.carbs += Number(food.carbs) || 0;
  target.fat += Number(food.fat) || 0;
}

function nutritionRangeBuckets(range = "day") {
  const selectedDate = new Date(`${selectedFoodDate}T12:00:00`);
  if (range === "day") {
    return Array.from({ length: 12 }, (_, index) => ({
      key: String(index),
      label: index === 0 ? "12 AM" : index === 3 ? "6 AM" : index === 6 ? "12 PM" : index === 9 ? "6 PM" : "",
      totals: blankNutritionTotals()
    }));
  }
  if (range === "week") {
    const start = weekStart(selectedFoodDate);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      return {
        key: date,
        label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${date}T12:00:00`)),
        totals: blankNutritionTotals()
      };
    });
  }
  if (range === "month") {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(year, month, index + 1, 12);
      const key = date.toISOString().slice(0, 10);
      return {
        key,
        label: index === 0 || index === days - 1 || (index + 1) % 7 === 0 ? String(index + 1) : "",
        totals: blankNutritionTotals()
      };
    });
  }
  const year = selectedDate.getFullYear();
  return Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    return {
      key,
      label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(`${key}-01T12:00:00`)),
      totals: blankNutritionTotals()
    };
  });
}

function foodBucketKey(food, range) {
  if (range === "day") {
    const stamp = food.createdAt ? new Date(food.createdAt) : null;
    const hour = stamp && !Number.isNaN(stamp.getTime()) ? stamp.getHours() : 12;
    return String(Math.min(11, Math.max(0, Math.floor(hour / 2))));
  }
  if (range === "week" || range === "month") return food.date;
  return String(food.date || "").slice(0, 7);
}

function nutritionSeriesForRange(range = "day") {
  const buckets = nutritionRangeBuckets(range);
  const byKey = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket.totals]));
  data.foods.forEach((food) => {
    const date = normalizeDateValue(food.date);
    if (range === "day" && date !== selectedFoodDate) return;
    if (range === "week") {
      const start = weekStart(selectedFoodDate);
      const end = addDays(start, 6);
      if (date < start || date > end) return;
    }
    if (range === "month" && date.slice(0, 7) !== selectedFoodDate.slice(0, 7)) return;
    if (range === "year" && date.slice(0, 4) !== selectedFoodDate.slice(0, 4)) return;
    const key = foodBucketKey(food, range);
    if (byKey[key]) addNutritionTotals(byKey[key], food);
  });
  return buckets;
}

function drawRoundedBar(ctx, x, y, width, height, radius) {
  const safeHeight = Math.max(1, height);
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, safeHeight, Math.min(radius, width / 2, safeHeight / 2));
    ctx.fill();
    return;
  }
  ctx.fillRect(x, y, width, safeHeight);
}

function drawNutritionTrendChart(totals) {
  const canvas = els.nutritionTrendChart;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = Math.floor(canvas.clientWidth || canvas.parentElement.clientWidth || 240);
  const height = Math.floor(canvas.clientHeight || 118);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const buckets = nutritionSeriesForRange();
  const goals = {
    calories: data.settings.calorieGoal || macroCalorieGoal(data.settings),
    protein: data.settings.proteinGoal || 170,
    carbs: data.settings.carbGoal || 250,
    fat: data.settings.fatGoal || 70
  };
  const metrics = [
    ["calories", "#202225"],
    ["protein", "#555b61"],
    ["carbs", "#9b9184"],
    ["fat", "#7e8893"]
  ];
  const padding = { top: 10, right: 8, bottom: 24, left: 8 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxRatio = Math.max(
    1,
    ...buckets.flatMap((bucket) => metrics.map(([key]) => (bucket.totals[key] || 0) / (goals[key] || 1)))
  );
  const step = plotWidth / Math.max(1, buckets.length);
  const groupWidth = Math.min(24, Math.max(8, step * 0.62));
  const barWidth = Math.max(2, (groupWidth - 3) / metrics.length);

  ctx.strokeStyle = "rgba(31, 36, 32, 0.1)";
  ctx.setLineDash([3, 5]);
  buckets.forEach((bucket, index) => {
    if (!bucket.label && range !== "day") return;
    const x = padding.left + step * index + step / 2;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotHeight);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(31, 36, 32, 0.12)";
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(width - padding.right, padding.top + plotHeight);
  ctx.stroke();

  buckets.forEach((bucket, index) => {
    const startX = padding.left + step * index + (step - groupWidth) / 2;
    metrics.forEach(([key, color], metricIndex) => {
      const value = bucket.totals[key] || 0;
      if (!value) return;
      const barHeight = Math.max(3, Math.min(plotHeight, (value / (goals[key] || 1) / maxRatio) * plotHeight));
      const x = startX + metricIndex * (barWidth + 1);
      const y = padding.top + plotHeight - barHeight;
      const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, "rgba(37, 88, 48, 0.38)");
      ctx.fillStyle = gradient;
      drawRoundedBar(ctx, x, y, barWidth, barHeight, 4);
    });
  });

  ctx.fillStyle = "#70746d";
  ctx.font = "10px system-ui";
  ctx.textAlign = "center";
  buckets.forEach((bucket, index) => {
    if (!bucket.label) return;
    const x = padding.left + step * index + step / 2;
    ctx.fillText(bucket.label, x, height - 8);
  });
  ctx.textAlign = "left";
}

function renderLiveDateTime() {
  if (!els.liveDateTime) return;
  els.liveDateTime.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());
}

function foodDayTrackWidth() {
  return els.foodDayTrack?.querySelector(".day-square")?.getBoundingClientRect().width || 66;
}

function foodDayBaseX() {
  const stripWidth = els.foodDayStrip?.clientWidth || 0;
  const dayWidth = foodDayTrackWidth();
  return stripWidth / 2 - dayWidth * 6 - dayWidth / 2;
}

function setFoodDayTrackX(x, moving = false, dragging = false) {
  if (!els.foodDayTrack) return;
  els.foodDayTrack.classList.toggle("carousel-moving", moving);
  els.foodDayTrack.classList.toggle("carousel-dragging", dragging);
  els.foodDayTrack.style.transform = `translateX(${x}px)`;
}

function resetFoodDayTrack() {
  if (!els.foodDayTrack) return;
  els.foodDayTrack.classList.remove("carousel-dragging", "carousel-moving");
  setFoodDayTrackX(foodDayBaseX());
}

function centerDateStripOnSelected() {
  dateStripCenterDate = selectedFoodDate;
  dateStripShouldCenter = true;
}

function updateDateStripEdge(strip) {
  if (!strip) return;
  const firstDay = strip.querySelector(".day-square");
  const dayWidth = firstDay?.getBoundingClientRect().width || 70;
  const edge = Math.max(12, (strip.clientWidth - dayWidth) / 2);
  strip.style.setProperty("--date-strip-edge", `${edge}px`);
}

function bindDateStripWheel(strip) {
  if (!strip || strip.dataset.wheelBound === "true") return;
  strip.dataset.wheelBound = "true";
  strip.addEventListener("wheel", (event) => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    strip.scrollBy({ left: delta, behavior: "smooth" });
  }, { passive: false });
  bindDateStripScrollSelection(strip);
}

function centeredDateInStrip(strip) {
  if (!strip) return "";
  const stripBox = strip.getBoundingClientRect();
  const stripCenter = stripBox.left + stripBox.width / 2;
  let closest = null;
  let closestDistance = Infinity;
  strip.querySelectorAll(".day-square[data-date]").forEach((button) => {
    const box = button.getBoundingClientRect();
    const center = box.left + box.width / 2;
    const distance = Math.abs(center - stripCenter);
    if (distance < closestDistance) {
      closest = button;
      closestDistance = distance;
    }
  });
  return closest?.dataset.date || "";
}

function bindDateStripScrollSelection(strip) {
  if (!strip || strip.dataset.scrollSelectBound === "true") return;
  strip.dataset.scrollSelectBound = "true";
  strip.addEventListener("scroll", () => {
    if (Date.now() < dateStripProgrammaticUntil) return;
    window.clearTimeout(dateStripScrollTimers.get(strip));
    const timer = window.setTimeout(() => {
      const centeredDate = centeredDateInStrip(strip);
      if (!centeredDate || centeredDate === selectedFoodDate) return;
      selectedFoodDate = centeredDate;
      dateStripCenterDate = centeredDate;
      dateStripShouldCenter = false;
      render();
    }, 140);
    dateStripScrollTimers.set(strip, timer);
  }, { passive: true });
}

function centerActiveDayInStrip(strip, behavior = "smooth") {
  const active = strip?.querySelector(".day-square.active");
  if (!strip || !active) return;
  updateDateStripEdge(strip);
  const left = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
  dateStripProgrammaticUntil = Date.now() + 450;
  strip.scrollTo({ left: Math.max(0, left), behavior });
}

function settleDateStripScroll(strip, previousScrollLeft, shouldCenter) {
  if (!strip) return;
  requestAnimationFrame(() => {
    if (shouldCenter) {
      centerActiveDayInStrip(strip);
    } else {
      strip.scrollLeft = previousScrollLeft;
    }
  });
}

function renderFoodDayControls() {
  if (els.foodDatePicker) els.foodDatePicker.value = selectedFoodDate;
  if (els.foodDayStrip && els.foodDayTrack) {
    const previousScrollLeft = els.foodDayStrip.scrollLeft;
    const shouldCenter = dateStripShouldCenter;
    els.foodDayTrack.innerHTML = "";
    const start = addDays(dateStripCenterDate || selectedFoodDate, -31);
    if (els.foodWeekLabel) {
      els.foodWeekLabel.textContent = formatFoodDay(selectedFoodDate);
    }
    const goals = {
      calories: data.settings.calorieGoal || macroCalorieGoal(data.settings),
      protein: data.settings.proteinGoal || 170,
      carbs: data.settings.carbGoal || 250,
      fat: data.settings.fatGoal || 70
    };
    const maxBars = data.foods.reduce(
      (max, food) => {
        const totals = foodTotals(food.date);
        return {
          calories: Math.max(max.calories, totals.calories),
          protein: Math.max(max.protein, totals.protein),
          carbs: Math.max(max.carbs, totals.carbs),
          fat: Math.max(max.fat, totals.fat)
        };
      },
      { calories: goals.calories, protein: goals.protein, carbs: goals.carbs, fat: goals.fat }
    );
    const barHeight = (value, goal, maxValue) => {
      if (!value) return 3;
      const scale = Math.max(goal, maxValue, 1);
      return Math.max(8, Math.min(34, Math.round((value / scale) * 34)));
    };
    for (let offset = 0; offset <= 62; offset += 1) {
      const date = addDays(start, offset);
      const snapshot = daySnapshot(date);
      const button = document.createElement("button");
      button.className = `day-square${date === selectedFoodDate ? " active" : ""}${date === today() ? " today" : ""}`;
      button.type = "button";
      button.dataset.date = date;
      const dayLabel = date === today() ? "Today" : new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${date}T12:00:00`));
      const dateLabel = new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(new Date(`${date}T12:00:00`));
      button.innerHTML = `
        <span class="day-label">${dayLabel}</span>
        <strong>${dateLabel}</strong>
        <small>${snapshot.totals.calories ? `${number(snapshot.totals.calories)}` : ""}</small>
        <div class="day-mini-chart" aria-hidden="true">
          <i class="calorie-bar" style="height: ${barHeight(snapshot.totals.calories, goals.calories, maxBars.calories)}px"></i>
          <i class="protein-bar" style="height: ${barHeight(snapshot.totals.protein, goals.protein, maxBars.protein)}px"></i>
          <i class="carb-bar" style="height: ${barHeight(snapshot.totals.carbs, goals.carbs, maxBars.carbs)}px"></i>
          <i class="fat-bar" style="height: ${barHeight(snapshot.totals.fat, goals.fat, maxBars.fat)}px"></i>
        </div>
      `;
      button.addEventListener("click", () => {
        if (Date.now() < dateStripDragSuppressUntil) return;
        selectedFoodDate = date;
        render();
      });
      els.foodDayTrack.append(button);
    }
    updateDateStripEdge(els.foodDayStrip);
    bindDateStripWheel(els.foodDayStrip);
    settleDateStripScroll(els.foodDayStrip, previousScrollLeft, shouldCenter);
  }
  if (els.logFoodButton) {
    els.logFoodButton.setAttribute("aria-label", "Add food");
  }
}

function closeCalendarSheet() {
  const wasOpen = els.calendarSheet?.classList.contains("open");
  els.calendarSheet?.classList.remove("open");
  els.calendarSheet?.setAttribute("aria-hidden", "true");
  if (els.calendarSheetPanel) els.calendarSheetPanel.hidden = true;
  if (wasOpen) unlockBackgroundScroll();
}

function renderCalendarSheet() {
  if (!els.calendarGrid) return;
  const first = new Date(`${monthKey(calendarViewDate)}-01T12:00:00`);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  if (els.calendarSheetTitle) els.calendarSheetTitle.textContent = monthLabel(calendarViewDate);
  els.calendarGrid.innerHTML = "";
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const value = date.toISOString().slice(0, 10);
    const snapshot = daySnapshot(value);
    const button = document.createElement("button");
    button.className = [
      "calendar-day",
      value === selectedFoodDate ? "active" : "",
      value === today() ? "today" : "",
      monthKey(value) !== monthKey(calendarViewDate) ? "outside" : "",
      snapshot.totals.calories || snapshot.foodCount || snapshot.liftCount || snapshot.weight ? "has-data" : ""
    ].filter(Boolean).join(" ");
    button.type = "button";
    button.dataset.date = value;
    button.innerHTML = `<span>${date.getDate()}</span><i aria-hidden="true"></i>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectedFoodDate = value;
      centerDateStripOnSelected();
      calendarViewDate = value;
      closeCalendarSheet();
      render();
    });
    els.calendarGrid.append(button);
  }
}

function openCalendarSheet() {
  if (els.calendarSheet?.classList.contains("open")) return;
  calendarViewDate = selectedFoodDate;
  renderCalendarSheet();
  if (els.calendarSheetPanel) els.calendarSheetPanel.hidden = false;
  els.calendarSheet?.classList.add("open");
  els.calendarSheet?.setAttribute("aria-hidden", "false");
  lockBackgroundScroll();
}

function dateSwitcherValue(scope, date, snapshot) {
  if (scope === "weight") {
    return snapshot.weight ? `${number(snapshot.weight.value, 1)} ${data.settings.weightUnit}` : "";
  }
  if (scope === "lifts") {
    const workout = workoutForDate(date);
    return snapshot.liftCount ? `${snapshot.liftCount} lifts` : workout?.title || "";
  }
  return snapshot.totals.calories ? `${number(snapshot.totals.calories)}` : "";
}

function dateSwitcherMiniChart(scope, date) {
  const clampHeight = (value) => Math.max(3, Math.min(22, Math.round(value)));
  const bar = (className, height) => `<i class="${className}" style="height: ${clampHeight(height)}px"></i>`;
  const days = [-3, -2, -1, 0].map((offset) => addDays(date, offset));
  if (scope === "weight") {
    const values = days.map((day) => sortedByDate(data.weights.filter((entry) => entry.date <= day))[0]?.value || 0);
    const activeValues = values.filter(Boolean);
    if (!activeValues.length) return values.map(() => bar("weight-bar empty-bar", 3)).join("");
    const min = Math.min(...activeValues);
    const max = Math.max(...activeValues);
    const span = Math.max(1, max - min);
    return values.map((value) => {
      const height = value ? 8 + ((value - min) / span) * 14 : 3;
      return bar(value ? "weight-bar" : "weight-bar empty-bar", height);
    }).join("");
  }
  if (scope === "lifts") {
    return days.map((day) => {
      const liftCount = data.lifts.filter((lift) => normalizeDateValue(lift.date, "") === day).length;
      const plannedCount = planItemsFor(workoutForDate(day) || { items: [] }).items.length;
      const height = liftCount ? 7 + Math.min(15, liftCount * 2) : plannedCount ? 8 + Math.min(10, plannedCount) : 3;
      return bar(liftCount ? "lift-bar" : plannedCount ? "lift-plan-bar" : "lift-empty-bar", height);
    }).join("");
  }
  return "";
}

function renderDateSwitchers() {
  els.dateSwitchers.forEach((switcher) => {
    const scope = switcher.dataset.dateSwitcher;
    const picker = switcher.querySelector("[data-date-picker]");
    const label = switcher.querySelector("[data-date-label]");
    const track = switcher.querySelector("[data-date-track]");
    const strip = track?.closest(".day-strip");
    if (picker) picker.value = selectedFoodDate;
    if (label) label.textContent = formatFoodDay(selectedFoodDate);
    if (!track) return;
    const previousScrollLeft = strip?.scrollLeft || 0;
    const shouldCenter = dateStripShouldCenter;
    track.innerHTML = "";
    const start = addDays(dateStripCenterDate || selectedFoodDate, -31);
    for (let offset = 0; offset <= 62; offset += 1) {
      const date = addDays(start, offset);
      const snapshot = daySnapshot(date);
      const button = document.createElement("button");
      button.className = `day-square${date === selectedFoodDate ? " active" : ""}${date === today() ? " today" : ""}`;
      button.type = "button";
      button.dataset.date = date;
      const dayLabel = date === today() ? "Today" : new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${date}T12:00:00`));
      const dateLabel = new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(new Date(`${date}T12:00:00`));
      button.innerHTML = `
        <span class="day-label">${dayLabel}</span>
        <strong>${dateLabel}</strong>
        <small>${dateSwitcherValue(scope, date, snapshot)}</small>
        <div class="day-mini-chart ${scope}-mini-chart" aria-hidden="true">
          ${dateSwitcherMiniChart(scope, date)}
        </div>
      `;
      button.addEventListener("click", () => {
        if (Date.now() < dateStripDragSuppressUntil) return;
        selectedFoodDate = date;
        render();
      });
      track.append(button);
    }
    updateDateStripEdge(strip);
    bindDateStripWheel(strip);
    settleDateStripScroll(strip, previousScrollLeft, shouldCenter);
  });
}

function renderWeightDaySummary() {
  if (!els.weightDaySummary) return;
  const selectedWeights = sortedByDate(data.weights.filter((entry) => normalizeDateValue(entry.date, "") === selectedFoodDate));
  const current = selectedWeights[0];
  const previous = sortedByDate(data.weights.filter((entry) => normalizeDateValue(entry.date, "") < selectedFoodDate))[0];
  els.weightDaySummary.querySelector("span").textContent = formatFoodDay(selectedFoodDate);
  if (!current) {
    els.weightDaySummary.querySelector("strong").textContent = "--";
    els.weightDaySummary.querySelector("small").textContent = "No weigh-in for this day";
    return;
  }
  const delta = previous ? current.value - previous.value : 0;
  const deltaText = previous ? `${delta >= 0 ? "+" : ""}${number(delta, 1)} ${data.settings.weightUnit} from last weigh-in` : "First weigh-in";
  els.weightDaySummary.querySelector("strong").textContent = `${number(current.value, 1)} ${data.settings.weightUnit}`;
  els.weightDaySummary.querySelector("small").textContent = deltaText;
}

function renderLiftDaySummary() {
  if (!els.liftDaySummary) return;
  const lifts = data.lifts.filter((lift) => normalizeDateValue(lift.date, "") === selectedFoodDate);
  const workout = workoutForDate(selectedFoodDate);
  const items = workout ? planItemsFor(workout).items : [];
  const topLift = lifts.reduce((best, lift) => ((Number(lift.weight) || 0) > (Number(best?.weight) || 0) ? lift : best), null);
  els.liftDaySummary.querySelector("span").textContent = formatFoodDay(selectedFoodDate);
  els.liftDaySummary.querySelector("strong").textContent = workout?.title || "Rest";
  if (lifts.length) {
    const topText = topLift ? `Top: ${topLift.exercise} ${number(topLift.weight, 1)} ${data.settings.weightUnit}` : "";
    els.liftDaySummary.querySelector("small").textContent = `${lifts.length} logged · ${topText}`;
    return;
  }
  const timerTotals = liftTimerTotals(selectedFoodDate);
  if (timerTotals.sets) {
    els.liftDaySummary.querySelector("small").textContent = `${timerTotals.sets} timed sets · ${formatDurationMs(timerTotals.setMs)} work · ${formatDurationMs(timerTotals.restMs)} rest`;
    return;
  }
  els.liftDaySummary.querySelector("small").textContent = items.length ? `${items.length} planned exercises` : "No planned lifts";
}

function liftTimerEntries(date = selectedFoodDate) {
  data.liftTimers = data.liftTimers && typeof data.liftTimers === "object" ? data.liftTimers : {};
  data.liftTimers[date] = Array.isArray(data.liftTimers[date]) ? data.liftTimers[date] : [];
  return data.liftTimers[date];
}

function plannedLiftItems(date = selectedFoodDate) {
  const workout = workoutForDate(date);
  if (!workout) return [];
  return planItemsFor(workout).items.filter((item) => {
    const name = Array.isArray(item) ? item[0] : item?.name;
    return name && !String(name).toLowerCase().includes("rest");
  });
}

function planItemName(item) {
  return Array.isArray(item) ? item[0] : item?.name || "Exercise";
}

function planItemPrescription(item) {
  return Array.isArray(item) ? item[1] : item?.prescription || "";
}

function planItemRestSeconds(item) {
  const raw = Array.isArray(item) ? item[3] : item?.restSeconds;
  const parsed = parseRestSeconds(raw);
  return parsed || DEFAULT_REST_SECONDS;
}

function planItemRestMs(item) {
  return planItemRestSeconds(item) * 1000;
}

function targetSetsForExercise(item) {
  return Math.max(1, parsePrescription(planItemPrescription(item)).sets || 1);
}

function normalizedLiftTimer(items = plannedLiftItems()) {
  const maxIndex = Math.max(0, items.length - 1);
  const exerciseIndex = Math.min(Math.max(0, Number(liftTimer.exerciseIndex) || 0), maxIndex);
  const targetSets = targetSetsForExercise(items[exerciseIndex]);
  const setIndex = Math.min(Math.max(1, Number(liftTimer.setIndex) || 1), targetSets);
  return { exerciseIndex, setIndex, targetSets, exercise: items[exerciseIndex] || null };
}

function nextLiftTimerPosition(items, exerciseIndex, setIndex) {
  const current = items[exerciseIndex];
  const targetSets = targetSetsForExercise(current);
  if (setIndex < targetSets) {
    return { exerciseIndex, setIndex: setIndex + 1, done: false };
  }
  if (exerciseIndex + 1 < items.length) {
    return { exerciseIndex: exerciseIndex + 1, setIndex: 1, done: false };
  }
  return { exerciseIndex, setIndex, done: true };
}

function previousLiftTimerPosition(items, exerciseIndex, setIndex) {
  if (setIndex > 1) return { exerciseIndex, setIndex: setIndex - 1 };
  const previousIndex = Math.max(0, exerciseIndex - 1);
  return {
    exerciseIndex: previousIndex,
    setIndex: previousIndex === exerciseIndex ? 1 : targetSetsForExercise(items[previousIndex])
  };
}

function completedLiftSetsByExercise(entries) {
  return entries.reduce((setMap, entry) => {
    if (!Number.isInteger(entry.exerciseIndex) || !entry.setNumber) return setMap;
    const key = String(entry.exerciseIndex);
    setMap[key] = setMap[key] || new Set();
    setMap[key].add(Number(entry.setNumber));
    return setMap;
  }, {});
}

function totalPlannedLiftSets(items) {
  return items.reduce((total, item) => total + targetSetsForExercise(item), 0);
}

function liftTimerTotals(date = selectedFoodDate) {
  return liftTimerEntries(date).reduce((totals, entry) => ({
    sets: totals.sets + (entry.setMs ? 1 : 0),
    setMs: totals.setMs + (Number(entry.setMs) || 0),
    restMs: totals.restMs + (Number(entry.restMs) || 0),
    plannedRestMs: totals.plannedRestMs + (Number(entry.restTargetMs) || 0)
  }), { sets: 0, setMs: 0, restMs: 0, plannedRestMs: 0 });
}

function currentLiftTimerElapsed() {
  if ((liftTimer.mode === "ready" || liftTimer.mode === "done") || !liftTimer.startedAt) return 0;
  const now = liftTimer.paused ? liftTimer.pausedAt : Date.now();
  return now - liftTimer.startedAt;
}

function renderLiftTimer() {
  if (!els.liftTimerCard) return;
  const items = plannedLiftItems();
  const active = normalizedLiftTimer(items);
  const entries = liftTimerEntries();
  const elapsed = currentLiftTimerElapsed();
  const restTargetMs = planItemRestMs(active.exercise);
  const restLeft = Math.max(0, restTargetMs - elapsed);
  const overRest = Math.max(0, elapsed - restTargetMs);
  const modeText = liftTimer.paused
    ? "Stopped"
    : liftTimer.mode === "set"
    ? "In set"
    : liftTimer.mode === "rest"
      ? "Rest"
      : liftTimer.mode === "done"
        ? "Complete"
        : "Ready";
  const hint = !items.length
    ? "Add exercises to today's plan to use the guided timer."
    : liftTimer.paused
      ? "Timer is stopped. Continue when you're ready."
      : liftTimer.mode === "set"
      ? "Tap when the set ends. Rest starts next."
      : liftTimer.mode === "rest"
        ? overRest ? `${formatDurationMs(overRest)} over rest. Tap to start.` : `${formatDurationMs(restLeft)} left. Tap to start early.`
        : liftTimer.mode === "done"
          ? "Workout complete. Reset to run it again."
          : "Tap start when your set begins.";
  els.liftTimerMode.textContent = modeText;
  els.liftTimerDisplay.textContent = liftTimer.mode === "rest" ? formatDurationMs(restLeft) : formatDurationMs(elapsed);
  els.liftTimerHint.textContent = hint;
  if (els.liftTimerExercise) els.liftTimerExercise.textContent = active.exercise ? planItemName(active.exercise) : "No exercise planned";
  if (els.liftTimerProgress) {
    els.liftTimerProgress.textContent = items.length
      ? `Exercise ${active.exerciseIndex + 1}/${items.length} · Set ${active.setIndex}/${active.targetSets} · Rest ${formatRestSeconds(restTargetMs / 1000)}`
      : "Add a workout first";
  }
  els.liftTimerTap.textContent = liftTimer.mode === "set" ? "End set" : liftTimer.mode === "rest" ? "Start next set" : liftTimer.mode === "done" ? "Done" : "Start set";
  els.liftTimerTap.disabled = !items.length || liftTimer.mode === "done" || liftTimer.paused;
  if (els.liftTimerPause) {
    els.liftTimerPause.textContent = liftTimer.paused ? "Continue" : "Stop";
    els.liftTimerPause.disabled = !items.length || liftTimer.mode === "ready" || liftTimer.mode === "done";
  }
  if (els.liftTimerPrevious) els.liftTimerPrevious.disabled = !items.length || (active.exerciseIndex === 0 && active.setIndex === 1);
  if (els.liftTimerSkip) els.liftTimerSkip.disabled = !items.length || liftTimer.mode === "done";
  const validEntries = entries.filter((entry) => Number.isInteger(entry.exerciseIndex) && entry.setNumber);
  els.liftTimerCount.textContent = `${validEntries.length}/${totalPlannedLiftSets(items)} sets`;
  els.liftTimerHistory.innerHTML = "";
  const completedSets = completedLiftSetsByExercise(entries);
  items.forEach((item, exerciseIndex) => {
    const targetSets = targetSetsForExercise(item);
    const completed = completedSets[String(exerciseIndex)] || new Set();
    const activeOnRow = exerciseIndex === active.exerciseIndex;
    const completedCount = Math.min(completed.size, targetSets);
    const statusCount = activeOnRow && liftTimer.mode === "set"
      ? `${completedCount} done · set ${active.setIndex}/${targetSets} running`
      : activeOnRow && liftTimer.mode === "rest"
        ? `${completedCount}/${targetSets} done · resting`
        : `${completedCount}/${targetSets} done`;
    const row = document.createElement("button");
    row.className = "lift-timer-step";
    row.type = "button";
    row.classList.toggle("active", activeOnRow);
    row.classList.toggle("complete", completedCount >= targetSets);
    row.dataset.exerciseIndex = String(exerciseIndex);
    row.dataset.setIndex = String(Math.min(targetSets, Math.max(1, completed.size + 1)));
    const labelWrap = document.createElement("span");
    const name = document.createElement("strong");
    const meta = document.createElement("small");
    const dotWrap = document.createElement("span");
    dotWrap.className = "lift-timer-dots";
    name.textContent = planItemName(item);
    meta.textContent = statusCount;
    labelWrap.append(name, meta);
    Array.from({ length: targetSets }, (_, index) => {
      const setNumber = index + 1;
      const isDone = completed.has(setNumber);
      const isActive = activeOnRow && setNumber === active.setIndex && !isDone && liftTimer.mode !== "done";
      const dot = document.createElement("i");
      dot.classList.toggle("done", isDone);
      dot.classList.toggle("current", isActive);
      dot.setAttribute("aria-hidden", "true");
      dotWrap.append(dot);
    });
    row.append(labelWrap, dotWrap);
    row.addEventListener("click", () => {
      liftTimer = { mode: "ready", startedAt: 0, currentSetStartedAt: 0, exerciseIndex, setIndex: Number(row.dataset.setIndex) || 1, paused: false, pausedAt: 0 };
      stopLiftTimerTicker();
      renderLiftTimer();
    });
    els.liftTimerHistory.append(row);
  });
}

function startLiftTimerTicker() {
  if (liftTimerInterval) return;
  liftTimerInterval = window.setInterval(renderLiftTimer, 50);
}

function stopLiftTimerTicker() {
  window.clearInterval(liftTimerInterval);
  liftTimerInterval = 0;
}

function handleLiftTimerTap() {
  const items = plannedLiftItems();
  if (!items.length || liftTimer.mode === "done" || liftTimer.paused) return;
  const now = Date.now();
  const entries = liftTimerEntries();
  const active = normalizedLiftTimer(items);
  if (liftTimer.mode === "ready") {
    liftTimer = { ...liftTimer, mode: "set", startedAt: now, currentSetStartedAt: now, exerciseIndex: active.exerciseIndex, setIndex: active.setIndex, paused: false, pausedAt: 0 };
    startLiftTimerTicker();
  } else if (liftTimer.mode === "set") {
    const setMs = currentLiftTimerElapsed();
    entries.push({
      id: uid(),
      startedAt: new Date(liftTimer.currentSetStartedAt).toISOString(),
      endedAt: new Date(now).toISOString(),
      exercise: active.exercise ? planItemName(active.exercise) : "Exercise",
      exerciseIndex: active.exerciseIndex,
      setNumber: active.setIndex,
      targetSets: active.targetSets,
      targetReps: parsePrescription(planItemPrescription(active.exercise)).reps || 1,
      setMs,
      restMs: 0,
      restTargetMs: planItemRestMs(active.exercise),
      workoutTitle: workoutForDate(selectedFoodDate)?.title || "",
      date: selectedFoodDate
    });
    liftTimer = { ...liftTimer, mode: "rest", startedAt: now, currentSetStartedAt: 0, exerciseIndex: active.exerciseIndex, setIndex: active.setIndex, paused: false, pausedAt: 0 };
    saveData();
  } else {
    const last = entries[entries.length - 1];
    if (last && !last.restMs) {
      last.restMs = currentLiftTimerElapsed();
      last.restEndedAt = new Date(now).toISOString();
    }
    const next = nextLiftTimerPosition(items, active.exerciseIndex, active.setIndex);
    liftTimer = next.done
      ? { mode: "done", startedAt: 0, currentSetStartedAt: 0, exerciseIndex: active.exerciseIndex, setIndex: active.setIndex, paused: false, pausedAt: 0 }
      : { mode: "set", startedAt: now, currentSetStartedAt: now, exerciseIndex: next.exerciseIndex, setIndex: next.setIndex, paused: false, pausedAt: 0 };
    saveData();
  }
  renderLiftTimer();
}

function resetLiftTimer() {
  if (liftTimer.mode !== "ready" && !confirm("Reset the active lift timer?")) return;
  liftTimer = { mode: "ready", startedAt: 0, currentSetStartedAt: 0, exerciseIndex: 0, setIndex: 1, paused: false, pausedAt: 0 };
  stopLiftTimerTicker();
  renderLiftTimer();
}

function skipLiftTimerExercise() {
  const items = plannedLiftItems();
  if (!items.length || liftTimer.mode === "done") return;
  const active = normalizedLiftTimer(items);
  if (liftTimer.mode === "rest") {
    const entries = liftTimerEntries();
    const last = entries[entries.length - 1];
    if (last && !last.restMs) {
      last.restMs = currentLiftTimerElapsed();
      last.restEndedAt = new Date().toISOString();
    }
  }
  const next = nextLiftTimerPosition(items, active.exerciseIndex, active.setIndex);
  liftTimer = next.done
    ? { mode: "done", startedAt: 0, currentSetStartedAt: 0, exerciseIndex: active.exerciseIndex, setIndex: active.setIndex, paused: false, pausedAt: 0 }
    : { mode: "ready", startedAt: 0, currentSetStartedAt: 0, exerciseIndex: next.exerciseIndex, setIndex: next.setIndex, paused: false, pausedAt: 0 };
  if (liftTimer.mode === "done") stopLiftTimerTicker();
  saveData();
  renderLiftTimer();
}

function previousLiftTimerSet() {
  const items = plannedLiftItems();
  if (!items.length) return;
  const active = normalizedLiftTimer(items);
  const previous = previousLiftTimerPosition(items, active.exerciseIndex, active.setIndex);
  liftTimer = { mode: "ready", startedAt: 0, currentSetStartedAt: 0, exerciseIndex: previous.exerciseIndex, setIndex: previous.setIndex, paused: false, pausedAt: 0 };
  stopLiftTimerTicker();
  renderLiftTimer();
}

function toggleLiftTimerPause() {
  if (liftTimer.mode === "ready" || liftTimer.mode === "done") return;
  const now = Date.now();
  if (!liftTimer.paused) {
    liftTimer = { ...liftTimer, paused: true, pausedAt: now };
    renderLiftTimer();
    return;
  }
  const pausedMs = now - liftTimer.pausedAt;
  liftTimer = {
    ...liftTimer,
    startedAt: liftTimer.startedAt + pausedMs,
    currentSetStartedAt: liftTimer.currentSetStartedAt ? liftTimer.currentSetStartedAt + pausedMs : 0,
    paused: false,
    pausedAt: 0
  };
  startLiftTimerTicker();
  renderLiftTimer();
}

function handleLiftTimerAction(event, action) {
  event.preventDefault();
  event.stopPropagation();
  if (action === "tap") {
    handleLiftTimerTap();
    return;
  }
  if (action === "reset") {
    resetLiftTimer();
    return;
  }
  if (action === "previous") {
    previousLiftTimerSet();
    return;
  }
  if (action === "pause") {
    toggleLiftTimerPause();
    return;
  }
  if (action === "skip") {
    skipLiftTimerExercise();
  }
}

function renderNutritionTracker() {
  const totals = foodTotals(selectedFoodDate);
  const goal = data.settings.calorieGoal;
  const percent = Math.min(100, Math.round((totals.calories / goal) * 100) || 0);
  const remainingCalories = Math.max(0, goal - totals.calories);
  const macroGoals = [
    ["protein", totals.protein, data.settings.proteinGoal || 170, "#trackerProtein", "#trackerProteinGoal"],
    ["carbs", totals.carbs, data.settings.carbGoal || 250, "#trackerCarbs", "#trackerCarbGoal"],
    ["fat", totals.fat, data.settings.fatGoal || 70, "#trackerFat", "#trackerFatGoal"]
  ];
  const trackerDateLabel = document.querySelector("#trackerDateLabel");
  const trackerHeaderDateLabel = document.querySelector("#trackerHeaderDateLabel");
  if (trackerDateLabel) trackerDateLabel.textContent = formatFoodDay(selectedFoodDate);
  if (trackerHeaderDateLabel) trackerHeaderDateLabel.textContent = formatFoodDay(selectedFoodDate);
  if (els.nutritionTrendTitle) els.nutritionTrendTitle.textContent = formatFoodDay(selectedFoodDate);
  if (els.nutritionTrendValue) els.nutritionTrendValue.textContent = `${number(totals.calories)} cal`;
  if (els.nutritionTrendGoal) els.nutritionTrendGoal.textContent = `${number(totals.calories)} / ${number(goal)} cal`;
  document.querySelector("#trackerGoal").textContent = `${number(totals.calories)} / ${number(goal)} cal`;
  document.querySelector("#trackerCalories").textContent = `${number(remainingCalories)} cal left`;
  document.querySelector("#trackerCalorieGoal").textContent = `${number(totals.calories)} / ${number(goal)} cal`;
  document.querySelector("#trackerPercent").textContent = `${percent}%`;
  document.querySelector(".tracker-calories").style.setProperty("--tracker-progress", `${percent}%`);
  macroGoals.forEach(([, value, macroGoal, valueSelector, goalSelector]) => {
    const valueNode = document.querySelector(valueSelector);
    const goalNode = document.querySelector(goalSelector);
    const card = valueNode?.closest(".tracker-ring-card");
    const macroPercent = Math.min(100, Math.round((value / macroGoal) * 100) || 0);
    if (card) card.style.setProperty("--tracker-progress", `${macroPercent}%`);
    if (valueNode) valueNode.textContent = `${number(value)}g`;
    if (goalNode) goalNode.textContent = `${number(value)} / ${number(macroGoal)}g`;
  });
  document.querySelector("#trackerFiber").textContent = `${number(totals.fiber)}g`;
  document.querySelector("#trackerSugar").textContent = `${number(totals.sugar)}g`;
  document.querySelector("#trackerSodium").textContent = `${number(totals.sodium)}mg`;
  document.querySelector("#trackerPotassium").textContent = `${number(totals.potassium)}mg`;
  drawNutritionTrendChart(totals);
}

function latestWeight() {
  return sortedByDate(data.weights)[0];
}

function previousDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function trendSymbol(delta, lowerIsGood = false) {
  if (!delta) return { arrow: "→", className: "flat" };
  const up = delta > 0;
  const good = lowerIsGood ? !up : up;
  return {
    arrow: up ? "↑" : "↓",
    className: good ? "good" : "bad"
  };
}

function bestLift() {
  return data.lifts.reduce((best, lift) => {
    const estimatedMax = lift.weight * (1 + lift.reps / 30);
    return estimatedMax > best.estimatedMax ? { ...lift, estimatedMax } : best;
  }, { estimatedMax: 0 });
}

function renderDashboard() {
  const totals = foodTotals();
  const yesterdayTotals = foodTotals(previousDate(today()));
  const latestWeights = sortedByDate(data.weights);
  const currentWeight = latestWeights[0];
  const previousWeight = latestWeights[1];
  const unit = data.settings.weightUnit;
  const caloriePercent = Math.min(999, Math.round((totals.calories / data.settings.calorieGoal) * 100) || 0);
  const topLift = bestLift();
  const calorieDelta = totals.calories - yesterdayTotals.calories;
  const calorieTrend = trendSymbol(calorieDelta);
  const weightDelta = currentWeight && previousWeight ? currentWeight.value - previousWeight.value : 0;
  const weightTrend = trendSymbol(weightDelta, true);

  document.querySelector("#dashboardDate").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(new Date(`${today()}T12:00:00`));
  document.querySelector("#todayCalories").textContent = `${number(totals.calories)} cal`;
  document.querySelector("#calorieTrend").textContent = calorieTrend.arrow;
  document.querySelector("#calorieTrend").className = `trend-indicator ${calorieTrend.className}`;
  document.querySelector("#todayMacros").textContent = `${number(totals.protein)}g protein · ${number(totals.carbs)}g carbs · ${number(totals.fat)}g fat`;
  document.querySelector("#caloriePercent").textContent = `${caloriePercent}%`;
  document.querySelector("#currentWeight").textContent = currentWeight ? `${number(currentWeight.value, 1)} ${unit}` : "--";
  document.querySelector("#weightTrend").textContent = currentWeight && previousWeight ? weightTrend.arrow : "→";
  document.querySelector("#weightTrend").className = `trend-indicator ${currentWeight && previousWeight ? weightTrend.className : "flat"}`;
  document.querySelector("#weightChange").textContent =
    currentWeight && previousWeight
      ? `${weightDelta >= 0 ? "+" : ""}${number(weightDelta, 1)} ${unit} from last entry`
      : "No comparison yet";
  document.querySelector("#bestLift").textContent = topLift.exercise ? `${number(topLift.estimatedMax)} ${unit}` : "--";
  document.querySelector("#bestLiftDetail").textContent = topLift.exercise ? `${topLift.exercise} estimated 1RM` : "Log a set to start";
  document.querySelector("#progressRangeLabel").textContent = { weeks: "Week", months: "Month", years: "Year" }[data.chart.range] || "Week";
  const workout = workoutForDate(selectedFoodDate);
  if (els.liftSummaryButton && workout?.title) {
    document.querySelector("#bestLiftDetail").textContent = topLift.exercise ? `${topLift.exercise} · ${workout.title} today` : `${workout.title} today`;
  }

  drawRing(totals.calories / data.settings.calorieGoal);
  drawProgressChart();
}

function drawRing(progress) {
  const canvas = els.calorieRing;
  const ctx = canvas.getContext("2d");
  const cssSize = Math.round(canvas.clientWidth || 72);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = cssSize * ratio;
  canvas.height = cssSize * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const center = cssSize / 2;
  const radius = Math.max(20, center - 9);
  ctx.clearRect(0, 0, cssSize, cssSize);
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#e3ded3";
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = progress > 1 ? "#9c928a" : "#202225";
  ctx.beginPath();
  ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(progress, 1));
  ctx.stroke();
}

function bucketConfig() {
  const range = data.chart.range;
  const count = range === "years" ? 12 : range === "months" ? 5 : 7;
  return { range, count };
}

function bucketKey(dateString, range) {
  const date = new Date(`${dateString}T12:00:00`);
  if (range === "years") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  if (range === "months") {
    const firstDay = new Date(date);
    firstDay.setDate(date.getDate() - date.getDay());
    return firstDay.toISOString().slice(0, 10);
  }
  return dateString;
}

function bucketLabel(key, range) {
  if (range === "years") return new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(`${key}-01T12:00:00`));
  if (range === "months") return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(new Date(`${key}T12:00:00`));
  if (range === "weeks") return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${key}T12:00:00`));
  return formatDate(key);
}

function getBuckets(anchorDate = selectedFoodDate || today()) {
  const { range, count } = bucketConfig();
  const buckets = [];
  const cursor = new Date(`${anchorDate}T12:00:00`);

  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(cursor);
    if (range === "years") date.setMonth(cursor.getMonth() - i, 1);
    if (range === "months") date.setDate(cursor.getDate() - cursor.getDay() - i * 7);
    if (range === "weeks") date.setDate(cursor.getDate() - i);
    if (range === "days") date.setDate(cursor.getDate());
    const dateString = date.toISOString().slice(0, 10);
    const key = bucketKey(dateString, range);
    buckets.push({ key, label: bucketLabel(key, range) });
  }
  return buckets;
}

function keyLiftForExercise(exercise = "") {
  const normalized = String(exercise).toLowerCase();
  return keyLiftOptions.find((lift) => normalized.includes(lift.match));
}

function chartMetric() {
  return ["calories", "weight", "lifts"].includes(data.chart.metric) ? data.chart.metric : "calories";
}

function latestChartDataDate(metric = chartMetric()) {
  const dates = [];
  if (metric === "calories") {
    data.foods.forEach((food) => {
      if ((Number(food.calories) || 0) > 0 && food.date) dates.push(normalizeDateValue(food.date));
    });
  } else if (metric === "weight") {
    data.weights.forEach((weight) => {
      if ((Number(weight.value) || 0) > 0 && weight.date) dates.push(normalizeDateValue(weight.date));
    });
  } else {
    data.lifts.forEach((lift) => {
      const progressWeight = Number(lift.progressWeight ?? lift.weight) || 0;
      if (progressWeight > 0 && lift.date) dates.push(normalizeDateValue(lift.date));
    });
  }
  return dates.sort().at(-1) || "";
}

function chartValueLabel(metric, value) {
  if (metric === "calories") return `${number(value, 0)} cal`;
  return `${number(value, 0)} ${data.settings.weightUnit}`;
}

function niceStep(rawStep) {
  const value = Math.max(Number(rawStep) || 1, 1);
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return nice * power;
}

function niceAxisBounds(metric, values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  const maxValue = finiteValues.length ? Math.max(...finiteValues) : 0;
  const minValue = finiteValues.length ? Math.min(...finiteValues) : 0;

  if (metric === "calories") {
    const goal = Number(data.settings.calorieGoal) || macroCalorieGoal(data.settings) || 2000;
    const axisMax = niceStep(Math.max(goal, maxValue, 1) / 2) * 2;
    return { min: 0, mid: axisMax / 2, max: axisMax };
  }

  if (!finiteValues.length) {
    return metric === "weight"
      ? { min: 0, mid: 5, max: 10 }
      : { min: 0, mid: 25, max: 50 };
  }

  const minimumSpan = metric === "weight" ? 10 : 50;
  const rawSpan = Math.max(maxValue - minValue, minimumSpan);
  const step = niceStep(rawSpan / 2);
  const span = Math.max(step * 2, minimumSpan);
  const center = (minValue + maxValue) / 2;
  let axisMin = Math.floor((center - span / 2) / step) * step;
  let axisMax = axisMin + step * 2;

  while (axisMin > minValue) {
    axisMin -= step;
    axisMax -= step;
  }
  while (axisMax < maxValue) {
    axisMin += step;
    axisMax += step;
  }
  if (axisMin < 0 && metric !== "weight") axisMin = 0;
  if (axisMin < 0 && metric === "weight") {
    axisMin = 0;
    axisMax = step * 2;
  }
  return { min: axisMin, mid: axisMin + (axisMax - axisMin) / 2, max: axisMax };
}

function metricSeries(buckets = getBuckets()) {
  const range = data.chart.range;
  const activeMetric = chartMetric();
  const byKey = Object.fromEntries(
    buckets.map((bucket) => [
      bucket.key,
      {
        calories: [],
        weight: [],
        lifts: [],
        keyLifts: Object.fromEntries(keyLiftOptions.map((lift) => [lift.id, []]))
      }
    ])
  );

  data.foods.forEach((food) => {
    const key = bucketKey(normalizeDateValue(food.date), range);
    if (byKey[key]) byKey[key].calories.push(food.calories);
  });

  data.weights.forEach((weight) => {
    const key = bucketKey(normalizeDateValue(weight.date), range);
    if (byKey[key]) byKey[key].weight.push(weight.value);
  });

  data.lifts.forEach((lift) => {
    const key = bucketKey(normalizeDateValue(lift.date), range);
    const progressWeight = Number(lift.progressWeight ?? lift.weight) || 0;
    if (!byKey[key] || !progressWeight) return;
    const estimatedMax = progressWeight * (1 + lift.reps / 30);
    byKey[key].lifts.push(estimatedMax);
    const keyLift = keyLiftForExercise(lift.exercise);
    if (keyLift) byKey[key].keyLifts[keyLift.id].push(estimatedMax);
  });

  const baseSeries = [
    {
      key: "calories",
      label: "Calories",
      color: "#9c928a",
      enabled: activeMetric === "calories",
      values: buckets.map((bucket) => {
        const values = byKey[bucket.key].calories;
        return values.length ? values.reduce((sum, item) => sum + item, 0) : null;
      })
    },
    {
      key: "weight",
      label: "Weight",
      color: "#7e8893",
      enabled: activeMetric === "weight",
      values: buckets.map((bucket) => {
        const values = byKey[bucket.key].weight;
        return values.length ? values[values.length - 1] : null;
      })
    },
    {
      key: "lifts",
      label: "Lifts",
      color: "#555b61",
      enabled: activeMetric === "lifts",
      values: buckets.map((bucket) => {
        const values = byKey[bucket.key].lifts;
        return values.length ? Math.max(...values) : null;
      })
    }
  ];

  return baseSeries;
}

function drawProgressChart() {
  const canvas = els.progressChart;
  const ctx = canvas.getContext("2d");
  const width = Math.floor(canvas.clientWidth || canvas.parentElement.clientWidth || 300);
  const height = Math.floor(canvas.clientHeight || 190);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const padding = { top: 16, right: 28, bottom: 34, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  let buckets = getBuckets();
  const range = data.chart.range;
  let series = metricSeries(buckets).filter((item) => item.enabled);
  let dataSeries = series.filter((item) => item.values.some((value) => value !== null));
  if (!dataSeries.length) {
    const latestDate = latestChartDataDate();
    if (latestDate) {
      buckets = getBuckets(latestDate);
      series = metricSeries(buckets).filter((item) => item.enabled);
      dataSeries = series.filter((item) => item.values.some((value) => value !== null));
    }
  }
  renderProgressLegend(dataSeries);
  const activeMetric = chartMetric();
  const allValues = dataSeries.flatMap((item) => item.values.filter((value) => value !== null));
  const axis = niceAxisBounds(activeMetric, allValues);
  let axisMin = axis.min;
  let axisMax = axis.max;
  if (axisMax <= axisMin) axisMax = axisMin + 1;
  const axisMid = axis.mid;

  ctx.strokeStyle = "rgba(17, 17, 15, 0.12)";
  ctx.lineWidth = 1;
  const yTicks = [
    { label: chartValueLabel(activeMetric, axisMax), value: 0 },
    { label: chartValueLabel(activeMetric, axisMid), value: 0.5 },
    { label: chartValueLabel(activeMetric, axisMin), value: 1 }
  ];
  yTicks.forEach((tick) => {
    const y = padding.top + tick.value * plotHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillStyle = "#77736a";
    ctx.font = "9px system-ui";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(tick.label, padding.left - 7, y);
  });

  ctx.strokeStyle = "rgba(17, 17, 15, 0.22)";
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(width - padding.right, padding.top + plotHeight);
  ctx.stroke();

  const step = buckets.length > 1 ? plotWidth / (buckets.length - 1) : 0;
  const xForIndex = (index) => (buckets.length > 1 ? padding.left + index * step : padding.left + plotWidth / 2);
  const labelForBucket = (bucket) => {
    if (range === "weeks") return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${bucket.key}T12:00:00`));
    if (range === "months") return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(new Date(`${bucket.key}T12:00:00`));
    return bucket.label;
  };
  const labelEvery = range === "years" ? 2 : 1;
  ctx.fillStyle = "#77736a";
  ctx.font = "10px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  buckets.forEach((bucket, index) => {
    const x = xForIndex(index);
    ctx.strokeStyle = "rgba(17, 17, 15, 0.16)";
    ctx.beginPath();
    ctx.moveTo(x, padding.top + plotHeight);
    ctx.lineTo(x, padding.top + plotHeight + 4);
    ctx.stroke();
    if (index % labelEvery === 0 || index === buckets.length - 1) {
      ctx.textAlign = index === 0 ? "left" : index === buckets.length - 1 ? "right" : "center";
      ctx.fillText(labelForBucket(bucket), x, padding.top + plotHeight + 7);
    }
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  if (!dataSeries.length) {
    ctx.fillStyle = "#6c7068";
    ctx.font = "13px system-ui";
    ctx.fillText("Add entries to see progress.", padding.left + 8, Math.round(height / 2));
    return;
  }

  dataSeries.forEach((item) => {
    const values = item.values.filter((value) => value !== null);
    if (!values.length) return;
    const spread = axisMax - axisMin;
    let started = false;

    ctx.strokeStyle = item.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    let lastPoint = null;
    item.values.forEach((value, index) => {
      if (value === null) {
        started = false;
        return;
      }
      const x = xForIndex(index);
      const y = padding.top + plotHeight - ((value - axisMin) / spread) * plotHeight;
      lastPoint = { x, y, value };
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    if (lastPoint) {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function renderProgressLegend(series) {
  if (!els.progressLegend) return;
  if (!series.length) {
    els.progressLegend.innerHTML = "";
    return;
  }
  els.progressLegend.innerHTML = "";
  series.forEach((item) => {
    const latest = [...item.values].reverse().find((value) => value !== null);
    const chip = document.createElement("span");
    chip.className = "legend-chip";
    chip.innerHTML = `
      <span class="lift-color-dot" style="background:${item.color}"></span>
      ${item.label}
      <strong>${number(latest, 0)}</strong>
    `;
    els.progressLegend.append(chip);
  });
}

function renderWeights() {
  const list = document.querySelector("#weightList");
  const unit = data.settings.weightUnit;
  const weights = data.weights.filter((entry) => normalizeDateValue(entry.date, "") === selectedFoodDate);
  document.querySelector("#weightDate").value = selectedFoodDate;
  document.querySelector("#weightCount").textContent = `${weights.length} ${weights.length === 1 ? "entry" : "entries"}`;
  list.innerHTML = "";

  if (!weights.length) {
    list.append(emptyState(selectedFoodDate === today() ? "Today's weigh-ins will show up here." : "No weigh-ins for this day."));
    return;
  }

  sortedByDate(weights).forEach((item) => {
    list.append(logRow(`${number(item.value, 1)} ${unit}`, formatDate(item.date), "weights", item.id));
  });
}

function renderLifts() {
  renderWorkoutPlan();
  const list = document.querySelector("#liftList");
  const unit = data.settings.weightUnit;
  const lifts = data.lifts.filter((lift) => normalizeDateValue(lift.date, "") === selectedFoodDate);
  document.querySelector("#liftDate").value = selectedFoodDate;
  document.querySelector("#liftCount").textContent = `${lifts.length} ${lifts.length === 1 ? "session" : "sessions"}`;
  list.innerHTML = "";

  if (!lifts.length) {
    list.append(emptyState(selectedFoodDate === today() ? "Today's lift sessions will show up here." : "No lift sessions for this day."));
    return;
  }

  sortedByDate(lifts).forEach((lift) => {
    const detail = `${formatDate(lift.date)} · ${lift.sets}x${lift.reps} at ${number(lift.weight, 1)} ${unit}`;
    list.append(liftRow(lift, detail));
  });
}

function activeWorkoutPlan() {
  data.workoutPlan = Array.isArray(data.workoutPlan) ? data.workoutPlan : structuredClone(workoutPlan);
  return data.workoutPlan;
}

function planItemsFor(day, plan = activeWorkoutPlan()) {
  if (!day.repeat) {
    return {
      owner: day,
      items: day.items || []
    };
  }
  const owner = plan.find((item) => item.day === day.repeat) || day;
  return {
    owner,
    items: owner.items || []
  };
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function planExerciseId(day, index, name) {
  const sourceDay = day.repeat || day.day;
  return `${slug(sourceDay)}-${index + 1}-${slug(name)}`;
}

function parsePrescription(prescription) {
  const match = String(prescription || "").match(/(\d+)\s*x\s*(\d+)/i);
  return {
    sets: Number(match?.[1]) || 1,
    reps: Number(match?.[2]) || 1
  };
}

function parseRestSeconds(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;
  const mmss = text.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (mmss) return Math.max(0, Number(mmss[1]) * 60 + Number(mmss[2]));
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*m/);
  if (minutes) return Math.round(Number(minutes[1]) * 60);
  const seconds = text.match(/(\d+(?:\.\d+)?)\s*s?/);
  return seconds ? Math.round(Number(seconds[1])) : 0;
}

function formatRestSeconds(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  if (safeSeconds >= 60) {
    const minutes = Math.floor(safeSeconds / 60);
    const restSeconds = safeSeconds % 60;
    return restSeconds ? `${minutes}:${String(restSeconds).padStart(2, "0")}` : `${minutes}:00`;
  }
  return `${safeSeconds}s`;
}

function firstLoadNumber(load) {
  const match = String(load || "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function loadLabel(weight, fallback = "") {
  const value = Number(weight);
  return value ? `${number(value, 1)} lb` : fallback;
}

function progressWeightFromLoad(load) {
  const text = String(load || "").trim().toLowerCase();
  if (!text || text.includes("bodyweight")) return 0;
  return firstLoadNumber(text);
}

function planDateLabel(dayName) {
  const dayNumbers = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 0 };
  if (!(dayName in dayNumbers)) return dayName;
  const current = new Date(`${selectedFoodDate}T12:00:00`);
  const monday = new Date(current);
  const currentDay = current.getDay() || 7;
  monday.setDate(current.getDate() - currentDay + 1);
  const target = new Date(monday);
  target.setDate(monday.getDate() + (dayNumbers[dayName] || 7) - 1);
  return `${dayName} · ${formatDate(target.toISOString().slice(0, 10))}`;
}

function renderWorkoutPlanHeader() {
  const heading = document.querySelector(".workout-plan-panel .section-heading");
  if (!heading) return;
  heading.closest(".workout-plan-panel")?.classList.toggle("workout-plan-editing", editingWorkoutPlan);
  heading.querySelectorAll(":scope > .workout-plan-edit, :scope > .workout-plan-cancel").forEach((button) => button.remove());
  let actions = heading.querySelector(".workout-plan-actions");
  if (!actions) {
    const label = heading.querySelector("span");
    if (label) label.remove();
    actions = document.createElement("div");
    actions.className = "workout-plan-actions";
    heading.append(actions);
  }
  actions.innerHTML = "";
  if (editingWorkoutPlan) {
    const cancelButton = document.createElement("button");
    cancelButton.className = "mini-button workout-plan-cancel";
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => {
      if (editingWorkoutPlanBackup) data.workoutPlan = structuredClone(editingWorkoutPlanBackup);
      editingWorkoutPlan = false;
      editingWorkoutPlanBackup = null;
      heading.closest(".workout-plan-panel")?.classList.remove("workout-plan-editing");
      renderWorkoutPlan();
      showToast("Edit canceled");
    });
    actions.append(cancelButton);
  }
  const editButton = document.createElement("button");
  editButton.className = "mini-button workout-plan-edit";
  editButton.type = "button";
  editButton.textContent = editingWorkoutPlan ? "Done" : "Edit";
  editButton.addEventListener("click", () => {
    if (editingWorkoutPlan) {
      if (!commitWorkoutPlanEdits()) return;
      editingWorkoutPlan = false;
      editingWorkoutPlanBackup = null;
      heading.closest(".workout-plan-panel")?.classList.remove("workout-plan-editing");
      saveData();
      showToast("Plan updated");
      return;
    }
    editingWorkoutPlanBackup = structuredClone(activeWorkoutPlan());
    editingWorkoutPlan = true;
    heading.closest(".workout-plan-panel")?.classList.add("workout-plan-editing");
    renderWorkoutPlan();
  });
  actions.append(editButton);
}

function commitWorkoutPlanEdits() {
  const plan = activeWorkoutPlan();
  document.querySelectorAll("#workoutPlan .workout-day").forEach((details) => {
    const day = plan.find((item) => item.day === details.dataset.day);
    if (!day) return;
    const title = details.querySelector(".plan-day-title")?.textContent.trim();
    if (title) day.title = title;
  });
  const rows = document.querySelectorAll("#workoutPlan .workout-exercise[data-owner-day]");
  plan.forEach((day) => {
    if (!day.repeat) day.items = [];
  });

  for (const row of rows) {
    if (row.dataset.ownerDay !== row.dataset.displayDay) continue;

    const nextName = row.querySelector("strong")?.textContent.trim() || "";
    if (!nextName) {
      showToast("Enter a workout name");
      return false;
    }

    const owner = plan.find((day) => day.day === row.dataset.ownerDay);
    if (!owner?.items) continue;

    const itemIndex = owner.items.length;
    const sets = Number(row.querySelector(".plan-lift-sets")?.textContent.trim()) || 0;
    const reps = Number(row.querySelector(".plan-lift-reps")?.textContent.trim()) || 0;
    const prescription = sets && reps ? `${sets} x ${reps}` : "Sets not set";
    const load = row.querySelector(".plan-lift-load")?.textContent.trim() || "";
    const restSeconds = parseRestSeconds(row.querySelector(".plan-lift-rest")?.textContent.trim()) || DEFAULT_REST_SECONDS;
    const weight = progressWeightFromLoad(load);
    const previousWeight = Number(row.dataset.weight) || 0;

    owner.items.push([nextName, prescription, load, restSeconds]);
    if (weight) {
      const planId = planExerciseId({ day: owner.day }, itemIndex, nextName);
      data.liftProgress = data.liftProgress || {};
      data.liftProgress[planId] = {
        day: row.dataset.displayDay || owner.day,
        title: row.dataset.title || owner.title,
        exercise: nextName,
        order: itemIndex + 1,
        prescription,
        weight,
        updatedAt: selectedFoodDate
      };
      if (weight !== previousWeight) {
        data.lifts.push({
          id: uid(),
          date: selectedFoodDate,
          exercise: nextName,
          sets: sets || 1,
          reps: reps || 1,
          weight,
          load,
          progressWeight: weight,
          planId,
          day: row.dataset.displayDay || owner.day,
          order: itemIndex + 1
        });
      }
    }
  }
  return true;
}

function activatePlanField(field) {
  if (!editingWorkoutPlan || field.isContentEditable) return;
  field.contentEditable = "true";
  field.inputMode = ["sets", "reps", "rest"].includes(field.dataset.field) ? "numeric" : "text";
  field.classList.add("editing");
  field.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(field);
  selection.removeAllRanges();
  selection.addRange(range);
}

function activateDayField(field) {
  if (!editingWorkoutPlan || field.isContentEditable) return;
  field.contentEditable = "true";
  field.classList.add("editing");
  field.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(field);
  selection.removeAllRanges();
  selection.addRange(range);
}

function bindDayControls(details) {
  details.querySelectorAll(".plan-day-field").forEach((field) => {
    field.addEventListener("click", (event) => {
      if (!editingWorkoutPlan) return;
      event.preventDefault();
      event.stopPropagation();
      activateDayField(field);
    });
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      field.blur();
    });
    field.addEventListener("blur", () => {
      field.contentEditable = "false";
      field.classList.remove("editing");
    });
  });
}

function bindPlanRowControls(row) {
  row.querySelectorAll(".plan-editable-field").forEach((field) => {
    field.addEventListener("click", () => activatePlanField(field));
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      field.blur();
    });
    field.addEventListener("blur", () => {
      field.contentEditable = "false";
      field.classList.remove("editing");
    });
  });

  const removeButton = row.querySelector(".plan-remove-button");
  const deletePopover = row.querySelector(".plan-delete-popover");
  removeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!editingWorkoutPlan) return;
    row.classList.toggle("confirm-delete");
  });
  row.querySelector(".plan-delete-cancel")?.addEventListener("click", (event) => {
    event.stopPropagation();
    row.classList.remove("confirm-delete");
  });
  row.querySelector(".plan-delete-confirm")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!editingWorkoutPlan) return;
    row.style.maxHeight = `${row.offsetHeight}px`;
    row.classList.remove("confirm-delete");
    row.classList.add("removing");
    window.setTimeout(() => row.remove(), 220);
  });
}

function bindPlanDrag(list) {
  let dragging = null;
  let placeholder = null;
  let drag = null;
  const moveDrag = (event) => {
    if (!dragging || !drag) return;
    dragging.style.left = `${event.clientX - drag.offsetX}px`;
    dragging.style.top = `${event.clientY - drag.offsetY}px`;
    const siblings = [...list.querySelectorAll(".workout-exercise")];
    const next = siblings.find((sibling) => event.clientY < sibling.getBoundingClientRect().top + sibling.offsetHeight / 2);
    list.insertBefore(placeholder, next || null);
  };
  const finishDrag = () => {
    if (!dragging) return;
    placeholder?.replaceWith(dragging);
    dragging.classList.remove("dragging");
    dragging.style.width = "";
    dragging.style.left = "";
    dragging.style.top = "";
    dragging.style.transform = "";
    dragging = null;
    placeholder = null;
    drag = null;
    window.removeEventListener("pointermove", moveDrag);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
  };
  list.addEventListener("pointerdown", (event) => {
    if (!editingWorkoutPlan) return;
    const handle = event.target.closest(".plan-row-handle");
    if (!handle) return;
    dragging = handle.closest(".workout-exercise");
    const rect = dragging.getBoundingClientRect();
    placeholder = document.createElement("div");
    placeholder.className = "workout-drag-placeholder";
    placeholder.style.height = `${rect.height}px`;
    dragging.before(placeholder);
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height
    };
    dragging.classList.add("dragging");
    dragging.style.width = `${rect.width}px`;
    dragging.style.left = `${rect.left}px`;
    dragging.style.top = `${rect.top}px`;
    dragging.style.transform = "none";
    document.body.append(dragging);
    handle.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    event.preventDefault();
  });
}

function createWorkoutRow(day, planGroup, item, itemIndex) {
  const [name, prescription, load] = item;
  const restSeconds = planItemRestSeconds(item);
  const planId = planExerciseId(day, itemIndex, name);
  const current = data.liftProgress?.[planId] || {};
  const parsed = parsePrescription(prescription);
  const currentWeight = current.weight || firstLoadNumber(load) || "";
  const row = document.createElement("div");
  row.className = "workout-exercise";
  row.dataset.ownerDay = planGroup.owner.day;
  row.dataset.displayDay = day.day;
  row.dataset.title = day.title;
  row.dataset.itemIndex = String(itemIndex);
  row.dataset.prescription = prescription;
  row.dataset.load = load;
  row.dataset.weight = String(progressWeightFromLoad(loadLabel(current.weight, load)) || 0);
  row.innerHTML = `
    <button class="plan-row-handle" type="button" aria-label="Move workout">☰</button>
    <div>
      <strong class="plan-editable-field" data-field="name" data-placeholder="Workout name"></strong>
      <div class="plan-row-lower">
        <small class="plan-prescription">
          <span class="plan-lift-sets plan-editable-field" data-field="sets" data-placeholder="Sets"></span>
          <span class="plan-x">x</span>
          <span class="plan-lift-reps plan-editable-field" data-field="reps" data-placeholder="Reps"></span>
        </small>
        <span class="plan-lift-load plan-editable-field" data-field="weight" data-placeholder="Weight"></span>
        <span class="plan-lift-rest plan-editable-field" data-field="rest" data-placeholder="Rest"></span>
      </div>
    </div>
    <button class="plan-remove-button" type="button" aria-label="Remove workout">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 4h6l.8 2H20v2H4V6h4.2L9 4Z"></path>
        <path d="M7 9h10l-.7 10.2A2 2 0 0 1 14.3 21H9.7a2 2 0 0 1-2-1.8L7 9Z"></path>
        <path d="M10 11v7M14 11v7"></path>
      </svg>
    </button>
    <div class="plan-delete-popover" role="dialog" aria-label="Confirm workout deletion">
      <span>Delete?</span>
      <button class="plan-delete-cancel" type="button">No</button>
      <button class="plan-delete-confirm" type="button">Yes</button>
    </div>
  `;
  row.querySelector("strong").textContent = name;
  row.querySelector(".plan-lift-sets").textContent = parsed.sets || "";
  row.querySelector(".plan-lift-reps").textContent = parsed.reps || "";
  row.querySelector(".plan-lift-load").textContent = loadLabel(current.weight, load);
  row.querySelector(".plan-lift-rest").textContent = formatRestSeconds(restSeconds);
  bindPlanRowControls(row);
  return row;
}

function addWorkoutRow(exerciseList, day, planGroup) {
  let targetGroup = planGroup;
  if (day.repeat) {
    day.items = structuredClone(planGroup.items || []);
    delete day.repeat;
    targetGroup = { owner: day, items: day.items };
    exerciseList.querySelectorAll(".workout-exercise").forEach((row) => {
      row.dataset.ownerDay = day.day;
    });
  }
  const row = createWorkoutRow(day, targetGroup, ["", "", "", DEFAULT_REST_SECONDS], exerciseList.querySelectorAll(".workout-exercise").length);
  row.classList.add("new-workout-row");
  exerciseList.insertBefore(row, exerciseList.querySelector(".plan-add-workout"));
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  activatePlanField(row.querySelector("strong"));
}

function renderWorkoutPlan() {
  const list = document.querySelector("#workoutPlan");
  if (!list) return;
  renderWorkoutPlanHeader();
  list.innerHTML = "";
  const plan = activeWorkoutPlan();
  const selectedDayName = dayNameForDate(selectedFoodDate);
  plan.forEach((day, index) => {
    const details = document.createElement("details");
    details.className = "workout-day";
    details.dataset.day = day.day;
    if (day.day === selectedDayName || (index === 0 && !plan.some((item) => item.day === selectedDayName))) details.open = true;
    details.innerHTML = `
      <summary>
        <span class="plan-day-name">${planDateLabel(day.day)}</span>
        <strong class="plan-day-title plan-day-field" data-placeholder="Day focus">${day.title}</strong>
      </summary>
      <div class="workout-exercises"></div>
    `;
    bindDayControls(details);
    const exerciseList = details.querySelector(".workout-exercises");
    const planGroup = planItemsFor(day, plan);
    planGroup.items.forEach((item, itemIndex) => {
      exerciseList.append(createWorkoutRow(day, planGroup, item, itemIndex));
    });
    const addButton = document.createElement("button");
    addButton.className = "plan-add-workout";
    addButton.type = "button";
    addButton.setAttribute("aria-label", `Add workout to ${day.day}`);
    addButton.textContent = "+";
    addButton.addEventListener("click", () => addWorkoutRow(exerciseList, day, planGroup));
    exerciseList.append(addButton);
    bindPlanDrag(exerciseList);
    list.append(details);
  });
}

function renderDiet() {
  const list = document.querySelector("#dietList");
  data.foods = Array.isArray(data.foods) ? data.foods.map(normalizeFoodLog) : [];
  const foods = data.foods
    .filter((food) => normalizeDateValue(food.date, "") === selectedFoodDate)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  document.querySelector("#dietCount").textContent = `${foods.length} ${foods.length === 1 ? "item" : "items"}`;
  list.innerHTML = "";

  if (!foods.length) {
    list.append(emptyState(selectedFoodDate === today() ? "Today's meals will show up here." : "No food logged for this day."));
    return;
  }

  foods.forEach((food) => {
    const detail = `${number(food.calories)} cal · ${number(food.protein)}P ${number(food.carbs)}C ${number(food.fat)}F`;
    list.append(foodRow(food, detail));
  });
}

function renderMeals() {
  const list = document.querySelector("#mealList");
  const query = els.mealSearch?.value.trim().toLowerCase() || "";
  const categoryOptions = [{ id: "all", label: "All" }, ...menuSections];
  const totalCount = data.meals.length;
  renderMealCategoryFilters(categoryOptions);
  const meals = data.meals.filter((meal) => {
    const text = `${meal.name} ${ingredientText(meal.ingredients)}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesCategory = selectedMealCategory === "all" || (meal.category || "lunch") === selectedMealCategory;
    return matchesQuery && matchesCategory;
  });
  if (els.mealLibraryCount) {
    const countLabel = selectedMealCategory === "all" ? totalCount : meals.length;
    els.mealLibraryCount.textContent = `${countLabel} ${countLabel === 1 ? "item" : "items"}`;
  }
  list.innerHTML = "";

  if (!meals.length) {
    const activeCategory = categoryOptions.find((section) => section.id === selectedMealCategory);
    const emptyText = query
      ? "No saved menus match."
      : selectedMealCategory === "all"
        ? "Create a saved menu to reuse it here."
        : `No ${activeCategory?.label.toLowerCase() || "menus"} saved yet.`;
    const empty = emptyState(emptyText);
    if (!query) {
      empty.classList.add("clickable-empty");
      empty.addEventListener("click", openMenuBuilder);
    }
    list.append(empty);
    return;
  }

  meals.forEach((meal) => list.append(mealRow(meal)));
}

function renderMealCategoryFilters(categoryOptions) {
  renderCategoryFilters(els.mealCategoryFilters, categoryOptions, selectedMealCategory);
}

function renderCategoryFilters(container, categoryOptions, activeCategory) {
  if (!container) return;
  const counts = Object.fromEntries(menuSections.map((section) => [section.id, 0]));
  data.meals.forEach((meal) => {
    const category = meal.category || "lunch";
    counts[category] = (counts[category] || 0) + 1;
  });
  container.innerHTML = "";
  categoryOptions.forEach((section) => {
    const button = document.createElement("button");
    const count = section.id === "all" ? data.meals.length : counts[section.id] || 0;
    button.className = `fridge-category-tab${activeCategory === section.id ? " active" : ""}`;
    button.type = "button";
    button.dataset.category = section.id;
    button.setAttribute("aria-pressed", String(activeCategory === section.id));
    button.innerHTML = `<span>${section.label}</span><small>${count}</small>`;
    container.append(button);
  });
}

function renderQuickMealPicker() {
  if (!els.quickMealPicker) return;
  const query = els.savedMenuSearch?.value.trim().toLowerCase() || "";
  els.quickMealPicker.hidden = !quickMealPickerOpen || (!query && !data.meals.length);
  els.quickMealPicker.innerHTML = "";
  if (els.quickMealPicker.hidden) return;

  const meals = data.meals.filter((meal) => {
    const text = `${meal.name} ${ingredientText(meal.ingredients)}`.toLowerCase();
    return !query || text.includes(query);
  });

  if (!meals.length) {
    els.quickMealPicker.append(emptyState(query ? "No saved menus match." : "No saved menus yet."));
    return;
  }

  renderMenuSections(els.quickMealPicker, meals, {
    compact: true,
    emptyText: () => ""
  });
}

function mealsBySection(meals) {
  return menuSections.map((section) => ({
    ...section,
    meals: meals.filter((meal) => (meal.category || "lunch") === section.id)
  }));
}

function renderMenuSections(container, meals, options = {}) {
  mealsBySection(meals).forEach((section) => {
    const group = document.createElement("section");
    group.className = `menu-section${options.compact ? " compact-menu-section" : ""}`;
    const count = section.meals.length;
    group.innerHTML = `
      <div class="menu-section-heading">
        <h3>${section.label}</h3>
        <span>${count} ${count === 1 ? "item" : "items"}</span>
      </div>
      <div class="menu-section-list"></div>
    `;
    const list = group.querySelector(".menu-section-list");
    if (section.meals.length) {
      section.meals.forEach((meal) => list.append(options.compact ? quickMealRow(meal) : mealRow(meal)));
    } else {
      const message = options.emptyText?.(section);
      if (message) list.append(menuSectionEmpty(message));
    }
    if (section.meals.length || (!options.compact && !options.hideEmptySections)) container.append(group);
  });
}

function quickMealRow(meal) {
  const row = document.createElement("article");
  row.className = "quick-meal-row";
  row.innerHTML = `
    <div>
      <strong></strong>
      <small></small>
    </div>
    <button class="small-plus-button" type="button" aria-label="Add menu">+</button>
  `;
  row.querySelector("strong").textContent = meal.name;
  row.querySelector("small").textContent = `${number(meal.calories)} cal · ${number(meal.protein)}P ${number(meal.carbs)}C ${number(meal.fat)}F`;
  row.querySelector("button").addEventListener("click", () => useMeal(meal));
  return row;
}

function menuSectionEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "menu-section-empty";
  empty.textContent = message;
  return empty;
}

function renderRecommendations() {
  const list = document.querySelector("#recommendationList");
  const pantry = new Set(parseIngredients(data.pantryIngredients));
  const matches = data.meals.filter((meal) =>
    meal.ingredients.length && meal.ingredients.every((ingredient) => pantry.has(ingredient.name.toLowerCase()))
  );
  document.querySelector("#recommendCount").textContent = `${matches.length} ${matches.length === 1 ? "match" : "matches"}`;
  list.innerHTML = "";

  if (!data.pantryIngredients.trim()) {
    list.innerHTML = "";
    return;
  }

  if (!matches.length) {
    list.append(emptyState("No saved meals match those ingredients yet."));
    return;
  }

  matches.forEach((meal) => list.append(mealRow(meal)));
}

function renderSettings() {
  data.settings.calorieGoal = Number(data.settings.calorieGoal) || defaultProfileData.settings.calorieGoal;
  document.querySelector("#goalCalories").value = number(data.settings.calorieGoal, 1).replace(/\.0$/, "");
  document.querySelector("#goalProtein").value = number(data.settings.proteinGoal, 1).replace(/\.0$/, "");
  document.querySelector("#goalCarbs").value = number(data.settings.carbGoal, 1).replace(/\.0$/, "");
  document.querySelector("#goalFat").value = number(data.settings.fatGoal, 1).replace(/\.0$/, "");
  if (els.settingsGoalSummary) {
    els.settingsGoalSummary.textContent = `${number(data.settings.calorieGoal, 1)} cal · ${number(data.settings.proteinGoal, 1)}P ${number(data.settings.carbGoal, 1)}C ${number(data.settings.fatGoal, 1)}F`;
  }
  renderMacroCalorieNotes();
  document.querySelector("#weightUnit").value = data.settings.weightUnit;
  document.querySelector("#weightEntryUnit").value = data.settings.weightUnit;
  renderDailyProgress();
}

function renderReadiness() {
  const streak = currentStreakInfo();
  const streakText = `${streak.count} ${streak.count === 1 ? "day" : "days"}`;
  if (els.currentStreak) els.currentStreak.textContent = streakText;
  if (els.streakDetail) {
    els.streakDetail.textContent = streak.activeToday
      ? "Logged today"
      : streak.count
        ? "Log today to keep it"
        : "Log food, weight, or lifts";
  }
  if (els.settingsStreak) els.settingsStreak.textContent = streakText;
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone;
  if (els.installStatus) els.installStatus.textContent = standalone ? "Installed" : "Add to Home Screen";
  if (els.phoneReadyStatus) els.phoneReadyStatus.textContent = navigator.serviceWorker ? "Offline shell ready" : "Browser only";
  if (els.phoneLinkStatus) {
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(window.location.origin);
    els.phoneLinkStatus.textContent = isLocalhost ? "Use Mac IP" : "Ready";
    updatePhoneLinkStatus();
  }
  const backupAt = localStorage.getItem(BACKUP_STATUS_KEY);
  const savedAt = localStorage.getItem(SAVE_STATUS_KEY);
  if (els.backupStatus) {
    els.backupStatus.textContent = backupAt
      ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(backupAt))
      : "Not exported";
  }
  if (els.lastSavedStatus) {
    els.lastSavedStatus.textContent = savedAt
      ? new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }).format(new Date(savedAt))
      : "Just now";
  }
  if (els.backupDetail) {
    const backupText = backupAt
      ? `Backup: ${new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }).format(new Date(backupAt))}`
      : "Export a backup before you start using this every day.";
    const savedText = savedAt
      ? ` Saved: ${new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }).format(new Date(savedAt))}.`
      : "";
    els.backupDetail.textContent = `${backupText}${savedText}`;
  }
}

let serverInfoPromise;

function updatePhoneLinkStatus() {
  if (!els.phoneLinkStatus || window.location.protocol === "file:") return;
  serverInfoPromise ||= fetch(`/app-info.json?fresh=${Date.now()}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);

  serverInfoPromise.then((info) => {
    if (!info?.urls?.length || !els.phoneLinkStatus) return;
    const lanUrl = info.urls.find((url) => !url.includes("localhost") && !url.includes("127.0.0.1"));
    els.phoneLinkStatus.textContent = lanUrl ? lanUrl.replace(/^https?:\/\//, "") : "Same device";
    els.phoneLinkStatus.title = lanUrl || window.location.origin;
  });
}

function renderMacroCalorieNotes() {
  const protein = Number(document.querySelector("#goalProtein")?.value) || 0;
  const carbs = Number(document.querySelector("#goalCarbs")?.value) || 0;
  const fat = Number(document.querySelector("#goalFat")?.value) || 0;
  const notes = [
    ["#goalProteinCalories", protein * 4],
    ["#goalCarbCalories", carbs * 4],
    ["#goalFatCalories", fat * 9]
  ];
  notes.forEach(([selector, calories]) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = `${number(calories, 0)} cal`;
  });
  renderMacroSuggestions();
}

function suggestedMacroGoal(target) {
  const calories = Number(document.querySelector("#goalCalories")?.value) || 0;
  const protein = Number(document.querySelector("#goalProtein")?.value) || 0;
  const carbs = Number(document.querySelector("#goalCarbs")?.value) || 0;
  const fat = Number(document.querySelector("#goalFat")?.value) || 0;
  if (!calories) return null;
  if (target === "protein") return Math.max(0, (calories - carbs * 4 - fat * 9) / 4);
  if (target === "carbs") return Math.max(0, (calories - protein * 4 - fat * 9) / 4);
  if (target === "fat") return Math.max(0, (calories - protein * 4 - carbs * 4) / 9);
  return null;
}

function renderMacroSuggestions() {
  document.querySelectorAll("[data-suggest-goal]").forEach((button) => {
    const target = button.dataset.suggestGoal;
    const input = document.querySelector(`#goal${target[0].toUpperCase()}${target.slice(1)}`);
    const suggestion = suggestedMacroGoal(target);
    const shouldShow = input && input.value === "" && suggestion != null && Number.isFinite(suggestion);
    button.hidden = !shouldShow;
    if (shouldShow) button.textContent = `Use suggested ${number(suggestion, 1)}g`;
  });
}

function openSettingsGoalSheet() {
  if (els.settingsGoalSheet?.classList.contains("open")) return;
  if (els.settingsGoalPanel) els.settingsGoalPanel.hidden = false;
  els.settingsGoalSheet?.classList.add("open");
  els.settingsGoalSheet?.setAttribute("aria-hidden", "false");
  lockBackgroundScroll();
  renderMacroCalorieNotes();
}

function closeSettingsGoalSheet() {
  const wasOpen = els.settingsGoalSheet?.classList.contains("open");
  els.settingsGoalSheet?.classList.remove("open");
  els.settingsGoalSheet?.setAttribute("aria-hidden", "true");
  if (els.settingsGoalPanel) els.settingsGoalPanel.hidden = true;
  if (wasOpen) unlockBackgroundScroll();
}

function renderDailyProgress() {
  const list = document.querySelector("#dailyProgressList");
  const count = document.querySelector("#dailyProgressCount");
  if (!list || !count) return;
  const dates = Array.from(new Set([
    ...loggedDateSet()
  ])).sort((a, b) => b.localeCompare(a));
  count.textContent = `${dates.length} ${dates.length === 1 ? "day" : "days"}`;
  list.innerHTML = "";
  if (!dates.length) {
    list.append(emptyState("Daily progress will show up here."));
    return;
  }
  dates.slice(0, 21).forEach((date) => {
    const totals = foodTotals(date);
    const weight = sortedByDate(data.weights.filter((entry) => normalizeDateValue(entry.date, "") === date))[0];
    const liftCount = data.lifts.filter((lift) => normalizeDateValue(lift.date, "") === date).length;
    const row = document.createElement("button");
    row.className = "daily-progress-row";
    row.type = "button";
    row.innerHTML = `
      <div>
        <strong>${formatFoodDay(date)}</strong>
        <small>${number(totals.calories)} / ${number(data.settings.calorieGoal)} cal · ${number(totals.protein)}P ${number(totals.carbs)}C ${number(totals.fat)}F</small>
      </div>
      <span>${liftCount ? `${liftCount} lifts` : weight ? `${number(weight.value, 1)} ${data.settings.weightUnit}` : "Open"}</span>
    `;
    row.addEventListener("click", () => {
      selectedFoodDate = date;
      centerDateStripOnSelected();
      switchToScreen("calories");
      render();
    });
    list.append(row);
  });
}

function renderProfiles() {
  const activeProfile = getActiveProfile();
  els.profileInitials.textContent = initials(activeProfile.name);
  els.profileList.innerHTML = "";

  store.profiles.forEach((profile) => {
    const row = document.createElement("article");
    const isActive = profile.id === activeProfile.id;
    const entryCount = profile.data.weights.length + profile.data.lifts.length + profile.data.foods.length;
    row.className = `profile-row${isActive ? " active" : ""}`;
    row.innerHTML = `
      <div class="profile-avatar"></div>
      <div>
        <strong></strong>
        <small></small>
      </div>
      <button class="profile-switch" type="button"></button>
    `;
    row.querySelector(".profile-avatar").textContent = initials(profile.name);
    row.querySelector("strong").textContent = profile.name;
    row.querySelector("small").textContent = `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`;
    const button = row.querySelector("button");
    button.textContent = isActive ? "Active" : "Switch";
    button.disabled = isActive;
    button.addEventListener("click", () => {
      store.activeProfileId = profile.id;
      data = getActiveProfile().data;
      resetEditors();
      saveData();
      closeProfileSheet();
      showToast(`Switched to ${profile.name}`);
    });
    els.profileList.append(row);
  });
}

function emptyState(message) {
  const row = document.createElement("div");
  row.className = "empty-state";
  row.textContent = message;
  return row;
}

function logRow(title, detail, collection, id) {
  const row = document.createElement("article");
  row.className = "log-row";
  row.innerHTML = `
    <div>
      <strong></strong>
      <small></small>
    </div>
    <button class="delete-button" type="button" aria-label="Delete entry">x</button>
  `;
  row.querySelector("strong").textContent = title;
  row.querySelector("small").textContent = detail;
  row.querySelector("button").addEventListener("click", () => {
    data[collection] = data[collection].filter((item) => item.id !== id);
    saveData();
    showToast("Entry deleted");
  });
  return row;
}

function foodRow(food, detail) {
  const row = document.createElement("article");
  row.className = `log-row food-log-row${food.photo ? " has-photo" : ""}`;
  row.innerHTML = `
    ${photoThumb(food.photo)}
    <div class="food-log-main">
      <strong></strong>
      <small></small>
    </div>
    <button class="delete-button delete-food" type="button" aria-label="Delete entry">x</button>
    <details class="logged-portion">
      <summary>Portion</summary>
      <div class="portion-compact-row">
        <div class="serving-mode" aria-label="Logged food portion type">
          <button class="serving-mode-button ${food.servingMode !== "weight" ? "active" : ""}" type="button" data-mode="serving">Serving</button>
          <button class="serving-mode-button ${food.servingMode === "weight" ? "active" : ""}" type="button" data-mode="weight">Weight</button>
        </div>
        <button class="mini-button duplicate-food" type="button">Duplicate</button>
      </div>
      <label class="logged-serving-count">
        Servings
        <input class="logged-serving-input" type="number" min="0" step="0.25" inputmode="decimal" />
      </label>
      <div class="weight-field logged-weight-field" hidden>
        <label>
          Amount
          <input class="logged-weight-input" type="number" min="0" step="0.1" inputmode="decimal" />
        </label>
        <label>
          Unit
          <select class="logged-weight-unit">
            <option value="g">g</option>
            <option value="oz">oz</option>
            <option value="ml">ml</option>
          </select>
        </label>
      </div>
    </details>
  `;
  row.querySelector("strong").textContent = food.name;
  row.querySelector("small").textContent = detail;
  if (food.photo) {
    row.classList.add("has-photo");
  }
  const servingInput = row.querySelector(".logged-serving-input");
  const weightInput = row.querySelector(".logged-weight-input");
  const weightUnit = row.querySelector(".logged-weight-unit");
  servingInput.value = food.servingCount || 1;
  weightInput.value = food.weightAmount || food.baseServingAmount || "";
  weightUnit.value = ["g", "oz", "ml"].includes(food.weightUnit) ? food.weightUnit : food.baseServingUnit || "g";
  row.querySelector(".logged-serving-count").hidden = food.servingMode === "weight";
  row.querySelector(".logged-weight-field").hidden = food.servingMode !== "weight";

  function updateLoggedFood(changes = {}) {
    const servingValue = servingInput.value === "" ? 0 : Number(servingInput.value);
    const weightValue = weightInput.value === "" ? 0 : Number(weightInput.value);
    const updated = applyFoodPortion({
      ...food,
      ...changes,
      servingCount: Number.isFinite(servingValue) ? servingValue : 1,
      weightAmount: Number.isFinite(weightValue) ? weightValue : 0,
      weightUnit: weightUnit.value
    });
    data.foods = data.foods.map((item) => (item.id === food.id ? updated : item));
    row.querySelector("small").textContent = `${number(updated.calories)} cal · ${number(updated.protein)}P ${number(updated.carbs)}C ${number(updated.fat)}F`;
    saveStore();
    renderNutritionTracker();
    renderDashboard();
  }

  row.querySelectorAll(".serving-mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      row.querySelectorAll(".serving-mode-button").forEach((item) => item.classList.toggle("active", item === button));
      row.querySelector(".logged-serving-count").hidden = button.dataset.mode === "weight";
      row.querySelector(".logged-weight-field").hidden = button.dataset.mode !== "weight";
      updateLoggedFood({ servingMode: button.dataset.mode });
    });
  });
  [servingInput, weightInput, weightUnit].forEach((input) => {
    input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => updateLoggedFood({ servingMode: row.querySelector(".serving-mode-button.active")?.dataset.mode || "serving" }));
  });
  row.querySelector(".duplicate-food").addEventListener("click", () => {
    data.foods.push({ ...food, id: uid() });
    saveData();
    showToast(`${food.name} duplicated`);
  });
  row.querySelector(".delete-food").addEventListener("click", () => {
    if (!confirm(`Remove ${food.name}?`)) return;
    data.foods = data.foods.filter((item) => item.id !== food.id);
    saveData();
    showToast("Entry deleted");
  });
  return row;
}

function liftRow(lift, detail) {
  const row = document.createElement("article");
  row.className = "log-row lift-log-row";
  row.innerHTML = `
    <div>
      <strong></strong>
      <small></small>
    </div>
    <div class="row-actions">
      <button class="mini-button edit-lift" type="button">Edit</button>
      <button class="delete-button delete-lift" type="button" aria-label="Delete lift">x</button>
    </div>
  `;
  row.querySelector("strong").textContent = lift.exercise;
  row.querySelector("small").textContent = detail;
  row.querySelector(".edit-lift").addEventListener("click", () => startLiftEdit(lift));
  row.querySelector(".delete-lift").addEventListener("click", () => {
    if (!confirm(`Remove ${lift.exercise}?`)) return;
    data.lifts = data.lifts.filter((item) => item.id !== lift.id);
    saveData();
    showToast("Lift deleted");
  });
  return row;
}

function mealRow(meal) {
  const row = document.createElement("article");
  row.className = `meal-row${meal.photo ? " has-photo" : ""}`;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-expanded", "false");
  row.innerHTML = `
    ${photoThumb(meal.photo)}
    <div>
      <strong></strong>
      <small></small>
    </div>
    <div class="row-actions">
      <button class="mini-button use-meal" type="button">Add</button>
      <button class="mini-button edit-meal" type="button">Edit</button>
      <button class="delete-button delete-meal" type="button" aria-label="Delete meal">x</button>
    </div>
  `;
  row.querySelector("strong").textContent = meal.name;
  row.querySelector("small").textContent = `${number(meal.calories)} cal · ${number(meal.protein)}P ${number(meal.carbs)}C ${number(meal.fat)}F`;
  row.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    const isOpen = !row.classList.contains("actions-open");
    row.classList.toggle("actions-open", isOpen);
    row.setAttribute("aria-expanded", String(isOpen));
  });
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    row.click();
  });
  row.querySelector(".use-meal").addEventListener("click", (event) => {
    event.stopPropagation();
    useMeal(meal);
  });
  row.querySelector(".edit-meal").addEventListener("click", (event) => {
    event.stopPropagation();
    startMealEdit(meal);
  });
  row.querySelector(".delete-meal").addEventListener("click", (event) => {
    event.stopPropagation();
    if (!confirm(`Remove ${meal.name}?`)) return;
    data.meals = data.meals.filter((item) => item.id !== meal.id);
    saveData();
    showToast("Meal deleted");
  });
  return row;
}

function renderLiftKeyToggles() {
  if (!els.liftKeyToggles) return;
  els.liftKeyToggles.innerHTML = "";
  keyLiftOptions.forEach((lift) => {
    const label = document.createElement("label");
    label.className = "toggle-pill lift-key-pill";
    label.innerHTML = `
      <input type="checkbox" data-lift-key="${lift.id}" />
      <span class="lift-color-dot" style="background:${lift.color}"></span>
      ${lift.label}
    `;
    label.querySelector("input").checked = data.chart.keyLifts?.[lift.id] !== false;
    els.liftKeyToggles.append(label);
  });
}

function render() {
  data = getActiveProfile().data;
  els.pantryInput.value = data.pantryIngredients;
  els.rangeControls.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === data.chart.range);
  });
  els.metricControls.forEach((button) => {
    button.classList.toggle("active", button.dataset.chartMetric === chartMetric());
  });
  renderProfiles();
  renderLiveDateTime();
  renderFoodDayControls();
  renderDateSwitchers();
  renderWeightDaySummary();
  renderLiftDaySummary();
  renderLiftTimer();
  renderNutritionTracker();
  renderDashboard();
  renderWeights();
  renderLifts();
  renderDiet();
  renderMeals();
  renderQuickMealPicker();
  renderIngredientBuilder();
  renderRecommendations();
  renderSettings();
  renderReadiness();
  dateStripShouldCenter = false;
}

function addIngredientRow(ingredient = {}) {
  mealIngredientDraft.push(normalizeIngredient({ servingMode: "weight", weightUnit: "g", ...ingredient }));
  renderIngredientBuilder();
}

function isIngredientBlank(ingredient) {
  return (
    !ingredient.name &&
    !ingredient.servingSize &&
    !ingredient.barcode &&
    !ingredient.baseServingSize &&
    !ingredient.calories &&
    !ingredient.protein &&
    !ingredient.carbs &&
    !ingredient.fat &&
    !ingredient.fiber &&
    !ingredient.sugar &&
    !ingredient.sodium &&
    !ingredient.potassium &&
    !ingredient.photo
  );
}

function ingredientSummary(ingredient) {
  return `${number(ingredient.calories)} cal · ${number(ingredient.protein)}P ${number(ingredient.carbs)}C ${number(ingredient.fat)}F`;
}

function setIngredientNutrition(row, ingredient) {
  row.querySelector(".ingredient-totals strong").textContent = ingredientSummary(ingredient);
  const title = row.querySelector(".ingredient-card-header strong");
  if (title) title.textContent = ingredient.name || "New ingredient";
}

function writeNutritionInputs(row, ingredient) {
  row.querySelector(".ingredient-calories").value = ingredient.calories || "";
  row.querySelector(".ingredient-protein").value = ingredient.protein || "";
  row.querySelector(".ingredient-carbs").value = ingredient.carbs || "";
  row.querySelector(".ingredient-fat").value = ingredient.fat || "";
  row.querySelector(".ingredient-fiber").value = ingredient.fiber || "";
  row.querySelector(".ingredient-sugar").value = ingredient.sugar || "";
  row.querySelector(".ingredient-sodium").value = ingredient.sodium || "";
  row.querySelector(".ingredient-potassium").value = ingredient.potassium || "";
}

function writeIngredientRow(row, ingredient) {
  row.querySelector(".ingredient-name").value = ingredient.name || "";
  row.querySelector(".ingredient-serving-count").value = ingredient.servingCount || 1;
  row.querySelector(".ingredient-weight-amount").value = ingredient.weightAmount || "";
  row.querySelector(".ingredient-weight-unit").value = ["g", "oz", "ml"].includes(ingredient.weightUnit) ? ingredient.weightUnit : "g";
  row.dataset.servingMode = ingredient.servingMode || "serving";
  row.querySelectorAll(".serving-mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === row.dataset.servingMode);
  });
  row.querySelector(".serving-count-field").hidden = row.dataset.servingMode !== "serving";
  row.querySelector(".weight-field").hidden = row.dataset.servingMode !== "weight";
  row.querySelector(".ingredient-barcode").value = ingredient.barcode || "";
  writeNutritionInputs(row, ingredient);
  setIngredientNutrition(row, ingredient);
}

function manualNutritionBaseFromRow(row) {
  const mode = row.dataset.servingMode || "serving";
  const servingCount = Number(row.querySelector(".ingredient-serving-count")?.value) || 1;
  const weightAmount = Number(row.querySelector(".ingredient-weight-amount")?.value) || 0;
  const weightUnit = row.querySelector(".ingredient-weight-unit")?.value || "g";
  const divisor = mode === "serving" ? servingCount || 1 : 1;
  const nutrition = {
    calories: (Number(row.querySelector(".ingredient-calories")?.value) || 0) / divisor,
    protein: (Number(row.querySelector(".ingredient-protein")?.value) || 0) / divisor,
    carbs: (Number(row.querySelector(".ingredient-carbs")?.value) || 0) / divisor,
    fat: (Number(row.querySelector(".ingredient-fat")?.value) || 0) / divisor,
    fiber: (Number(row.querySelector(".ingredient-fiber")?.value) || 0) / divisor,
    sugar: (Number(row.querySelector(".ingredient-sugar")?.value) || 0) / divisor,
    sodium: (Number(row.querySelector(".ingredient-sodium")?.value) || 0) / divisor,
    potassium: (Number(row.querySelector(".ingredient-potassium")?.value) || 0) / divisor
  };

  if (mode === "weight") {
    return {
      baseServingSize: weightAmount ? `${weightAmount}${weightUnit}` : "",
      baseServingAmount: weightAmount,
      baseServingUnit: weightUnit,
      baseNutrition: nutrition
    };
  }

  return {
    baseServingSize: "1 serving",
    baseServingAmount: 1,
    baseServingUnit: "serving",
    baseNutrition: nutrition
  };
}

async function lookupBarcodeForIngredient(row, index, barcode, photo = "") {
  if (!row || index == null) return;
  const cleanBarcode = String(barcode || "").trim();
  if (!cleanBarcode) {
    showToast("Enter a barcode number");
    return;
  }
  row.querySelector(".ingredient-barcode").value = cleanBarcode;
  showToast("Looking up barcode...");
  try {
    const product = await lookupBarcodeNutrition(cleanBarcode);
    const updated = productNutrition(product, cleanBarcode, photo || mealIngredientDraft[index]?.photo || "", readIngredientRow(row, mealIngredientDraft[index]?.id));
    mealIngredientDraft[index] = updated;
    writeIngredientRow(row, updated);
    updateMealTotals();
    closeBarcodeScanner();
    showToast("Nutrition filled");
  } catch (error) {
    showToast(error.message || "Barcode lookup failed");
  }
}

function writeCustomFoodFromBarcodeNutrition(ingredient) {
  customFoodDraftNutrition = baseNutritionFromIngredient(ingredient);
  if (els.customFoodName) els.customFoodName.value = ingredient.name || "";
  if (els.customFoodBarcode) els.customFoodBarcode.value = ingredient.barcode || "";
  if (els.customFoodCalories) els.customFoodCalories.value = ingredient.calories ? number(ingredient.calories, 1).replace(/\.0$/, "") : "";
  if (els.customFoodProtein) els.customFoodProtein.value = ingredient.protein ? number(ingredient.protein, 1).replace(/\.0$/, "") : "";
  if (els.customFoodCarbs) els.customFoodCarbs.value = ingredient.carbs ? number(ingredient.carbs, 1).replace(/\.0$/, "") : "";
  if (els.customFoodFat) els.customFoodFat.value = ingredient.fat ? number(ingredient.fat, 1).replace(/\.0$/, "") : "";
  syncCustomCaloriesFromMacros();
}

async function lookupBarcodeForCustomFood(barcode) {
  const cleanBarcode = String(barcode || "").trim();
  if (!cleanBarcode) {
    showToast("Enter a barcode number");
    return;
  }
  if (els.customFoodBarcode) els.customFoodBarcode.value = cleanBarcode;
  showToast("Looking up barcode...");
  try {
    const product = await lookupBarcodeNutrition(cleanBarcode);
    const ingredient = productNutrition(product, cleanBarcode, "", { name: els.customFoodName?.value.trim() || "" });
    writeCustomFoodFromBarcodeNutrition(ingredient);
    closeBarcodeScanner();
    showToast("Nutrition filled");
  } catch (error) {
    showToast(error.message || "Barcode lookup failed");
  }
}

function lookupBarcodeFromScanner(barcode) {
  if (barcodeScanState.mode === "customFood") return lookupBarcodeForCustomFood(barcode);
  return lookupBarcodeForIngredient(barcodeScanState.row, barcodeScanState.index, barcode);
}

async function openBarcodeScanner(row, index) {
  const wasOpen = els.barcodeScanner?.classList.contains("open");
  barcodeScanState = { ...barcodeScanState, mode: "ingredient", row, index };
  els.scannerBarcodeInput.value = row.querySelector(".ingredient-barcode")?.value || "";
  if (els.scannerPhotoButton) els.scannerPhotoButton.hidden = false;
  els.barcodeScanner.classList.add("open");
  els.barcodeScanner.setAttribute("aria-hidden", "false");
  if (!wasOpen) lockBackgroundScroll();
  els.scannerBarcodeInput.focus();

  if (!navigator.mediaDevices?.getUserMedia || !("BarcodeDetector" in window)) {
    showToast("Camera scanner unavailable. Enter barcode or use camera photo.");
    return;
  }

  try {
    barcodeScanState.detector = new BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
    });
    barcodeScanState.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    els.barcodeVideo.srcObject = barcodeScanState.stream;
    await els.barcodeVideo.play();
    scanBarcodeFrame();
  } catch {
    showToast("Camera blocked. Enter barcode or use camera photo.");
  }
}

async function openCustomFoodBarcodeScanner() {
  els.customFoodBarcodePhoto?.click();
  showToast("Take a clear barcode photo");
}

async function handleCustomFoodBarcodePhoto(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  showToast("Reading barcode photo...");
  const detectedBarcode = await detectBarcodeFromFile(file);
  if (detectedBarcode) {
    await lookupBarcodeForCustomFood(detectedBarcode);
    return;
  }
  els.customFoodBarcode?.focus({ preventScroll: true });
  showToast("Could not read barcode. Type the number.");
}

async function scanBarcodeFrame() {
  const { detector, row, mode } = barcodeScanState;
  if (!detector || (mode !== "customFood" && !row) || els.barcodeScanner.getAttribute("aria-hidden") === "true") return;
  try {
    const codes = await detector.detect(els.barcodeVideo);
    const value = codes[0]?.rawValue || "";
    if (value) {
      els.scannerBarcodeInput.value = value;
      await lookupBarcodeFromScanner(value);
      return;
    }
  } catch {
    // Keep scanning. Some frames are too blurry for the detector.
  }
  barcodeScanState.frame = requestAnimationFrame(scanBarcodeFrame);
}

function closeBarcodeScanner() {
  const wasOpen = els.barcodeScanner?.classList.contains("open");
  if (barcodeScanState.frame) cancelAnimationFrame(barcodeScanState.frame);
  barcodeScanState.stream?.getTracks?.().forEach((track) => track.stop());
  if (els.barcodeVideo) els.barcodeVideo.srcObject = null;
  if (els.scannerPhotoButton) els.scannerPhotoButton.hidden = false;
  barcodeScanState = { mode: "ingredient", row: null, index: null, stream: null, frame: 0, detector: null };
  els.barcodeScanner?.classList.remove("open");
  els.barcodeScanner?.setAttribute("aria-hidden", "true");
  if (wasOpen) unlockBackgroundScroll();
}

function renderIngredientBuilder() {
  els.ingredientList.innerHTML = "";
  if (!mealIngredientDraft.length) {
    addIngredientRow({ name: "", servingMode: "weight", weightUnit: "g", calories: 0, protein: 0, carbs: 0, fat: 0 });
    return;
  }

  mealIngredientDraft.forEach((ingredient, index) => {
    const row = document.createElement("div");
    row.className = "ingredient-row";
    row.innerHTML = `
      <div class="ingredient-card-header">
        <div>
          <span>Ingredient ${index + 1}</span>
          <strong></strong>
        </div>
        <button class="remove-ingredient" type="button">Remove</button>
      </div>
      <label class="ingredient-name-field">
        Ingredient name
        <input class="ingredient-name" type="text" placeholder="Matcha powder" />
      </label>
      <div class="serving-control">
        <span>Serving size / weight</span>
        <div class="serving-mode" aria-label="Serving input type">
          <button class="serving-mode-button active" type="button" data-mode="serving">Serving</button>
          <button class="serving-mode-button" type="button" data-mode="weight">Weight</button>
        </div>
        <label class="serving-count-field compact-amount-field">
          Servings
          <input class="ingredient-serving-count" type="number" min="0" step="0.25" inputmode="decimal" placeholder="1" />
        </label>
        <div class="weight-field compact-amount-field" hidden>
          <label>
            Amount
            <input class="ingredient-weight-amount" type="number" min="0" step="0.1" inputmode="decimal" placeholder="20" />
          </label>
          <label>
            Unit
            <select class="ingredient-weight-unit">
              <option value="g">g</option>
              <option value="oz">oz</option>
              <option value="ml">ml</option>
            </select>
          </label>
        </div>
      </div>
      <label class="photo-field ingredient-photo-field scanner-photo-input">
        Barcode photo fallback
        <input class="ingredient-photo-input" type="file" accept="image/*" capture="environment" />
        <span class="photo-button">Camera photo</span>
      </label>
      <div class="photo-preview ingredient-photo-preview" hidden></div>
      <input class="ingredient-barcode" type="hidden" />
      <div class="ingredient-action-row">
        <button class="secondary-button scan-barcode" type="button">Scan barcode</button>
        <button class="secondary-button manual-macro-toggle" type="button" aria-expanded="false">Manual input</button>
      </div>
      <button class="ingredient-totals ingredient-total-button" type="button" aria-expanded="false">
        <span>Ingredient total</span>
        <strong>0 cal · 0P 0C 0F</strong>
      </button>
      <div class="nutrition-editor" hidden>
        <p class="field-help">No barcode? Enter calories and macros for the amount above.</p>
        <div class="form-row nutrition-grid">
          <label>
            Calories
            <input class="ingredient-calories" type="number" min="0" step="1" inputmode="numeric" placeholder="60" />
          </label>
          <label>
            Protein
            <input class="ingredient-protein" type="number" min="0" step="0.1" inputmode="decimal" placeholder="7" />
          </label>
          <label>
            Carbs
            <input class="ingredient-carbs" type="number" min="0" step="0.1" inputmode="decimal" placeholder="6" />
          </label>
          <label>
            Fat
            <input class="ingredient-fat" type="number" min="0" step="0.1" inputmode="decimal" placeholder="2" />
          </label>
        </div>
        <details class="micro-editor">
          <summary>Micros</summary>
          <div class="form-row nutrition-grid">
            <label>
              Fiber
              <input class="ingredient-fiber" type="number" min="0" step="0.1" inputmode="decimal" placeholder="2" />
            </label>
            <label>
              Sugar
              <input class="ingredient-sugar" type="number" min="0" step="0.1" inputmode="decimal" placeholder="4" />
            </label>
            <label>
              Sodium
              <input class="ingredient-sodium" type="number" min="0" step="1" inputmode="numeric" placeholder="95" />
            </label>
            <label>
              Potassium
              <input class="ingredient-potassium" type="number" min="0" step="1" inputmode="numeric" placeholder="180" />
            </label>
          </div>
        </details>
      </div>
    `;
    writeIngredientRow(row, ingredient);
    setPhotoPreview(row.querySelector(".ingredient-photo-preview"), ingredient.photo || "", () => {
      mealIngredientDraft[index] = { ...readIngredientRow(row, ingredient.id), photo: "" };
      row.querySelector(".ingredient-photo-input").value = "";
      showToast("Photo removed");
    });
    row.querySelector(".ingredient-total-button").addEventListener("click", () => {
      const editor = row.querySelector(".nutrition-editor");
      const isOpen = editor.hidden;
      editor.hidden = !isOpen;
      row.querySelector(".ingredient-total-button").setAttribute("aria-expanded", String(isOpen));
      row.querySelector(".manual-macro-toggle").setAttribute("aria-expanded", String(isOpen));
      row.querySelector(".manual-macro-toggle").textContent = isOpen ? "Hide manual" : "Manual input";
    });
    row.querySelector(".manual-macro-toggle").addEventListener("click", () => {
      const editor = row.querySelector(".nutrition-editor");
      const isOpen = editor.hidden;
      editor.hidden = !isOpen;
      row.querySelector(".ingredient-total-button").setAttribute("aria-expanded", String(isOpen));
      row.querySelector(".manual-macro-toggle").setAttribute("aria-expanded", String(isOpen));
      row.querySelector(".manual-macro-toggle").textContent = isOpen ? "Hide manual" : "Manual input";
    });
    row.querySelectorAll(".serving-mode-button").forEach((button) => {
      button.addEventListener("click", () => {
        row.dataset.servingMode = button.dataset.mode;
        row.querySelectorAll(".serving-mode-button").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
        row.querySelector(".serving-count-field").hidden = button.dataset.mode !== "serving";
        row.querySelector(".weight-field").hidden = button.dataset.mode !== "weight";
        mealIngredientDraft[index] = readIngredientRow(row, ingredient.id);
        writeIngredientRow(row, mealIngredientDraft[index]);
        updateMealTotals();
      });
    });
    row.querySelectorAll("input:not(.ingredient-photo-input), select").forEach((input) => {
      const handleIngredientInput = () => {
        const isNutritionInput = input.matches(".ingredient-calories, .ingredient-protein, .ingredient-carbs, .ingredient-fat, .ingredient-fiber, .ingredient-sugar, .ingredient-sodium, .ingredient-potassium");
        if (isNutritionInput) {
          mealIngredientDraft[index] = {
            ...mealIngredientDraft[index],
            ...manualNutritionBaseFromRow(row)
          };
        }
        mealIngredientDraft[index] = readIngredientRow(row, ingredient.id);
        if (input.matches(".ingredient-weight-unit")) {
          writeIngredientRow(row, mealIngredientDraft[index]);
        } else if (!isNutritionInput && mealIngredientDraft[index].baseNutrition && input.matches(".ingredient-serving-count, .ingredient-weight-amount")) {
          writeNutritionInputs(row, mealIngredientDraft[index]);
        }
        setIngredientNutrition(row, mealIngredientDraft[index]);
        updateMealTotals();
      };
      input.addEventListener("input", handleIngredientInput);
      if (input.tagName === "SELECT") input.addEventListener("change", handleIngredientInput);
    });
    row.querySelector(".scan-barcode").addEventListener("click", () => openBarcodeScanner(row, index));
    row.querySelector(".ingredient-photo-input").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const photo = await compressImage(file);
      const nameInput = row.querySelector(".ingredient-name");
      if (!nameInput.value.trim()) {
        const inferredName = ingredientNameFromFile(file);
        if (inferredName) nameInput.value = inferredName;
      }
      setPhotoPreview(row.querySelector(".ingredient-photo-preview"), photo, () => {
        mealIngredientDraft[index] = { ...readIngredientRow(row, ingredient.id), photo: "" };
        row.querySelector(".ingredient-photo-input").value = "";
        showToast("Photo removed");
      });
      mealIngredientDraft[index] = { ...readIngredientRow(row, ingredient.id), photo };
      updateMealTotals();
      showToast("Reading barcode...");
      const detectedBarcode = await detectBarcodeFromFile(file);
      const typedBarcode = detectedBarcode || prompt("Could not read the barcode automatically. Type the barcode number, or leave blank to just save the photo.", "")?.trim();
      if (!typedBarcode) {
        closeBarcodeScanner();
        showToast("Photo added");
        return;
      }
      row.querySelector(".ingredient-barcode").value = typedBarcode;
      try {
        const product = await lookupBarcodeNutrition(typedBarcode);
        const updated = productNutrition(product, typedBarcode, photo, readIngredientRow(row, ingredient.id));
        mealIngredientDraft[index] = updated;
        writeIngredientRow(row, updated);
        setPhotoPreview(row.querySelector(".ingredient-photo-preview"), photo, () => {
          mealIngredientDraft[index] = { ...readIngredientRow(row, ingredient.id), photo: "" };
          row.querySelector(".ingredient-photo-input").value = "";
          showToast("Photo removed");
        });
        updateMealTotals();
        closeBarcodeScanner();
        showToast("Nutrition filled");
      } catch (error) {
        showToast(error.message || "Barcode lookup failed");
      }
    });
    row.querySelector(".remove-ingredient").addEventListener("click", () => {
      const current = readIngredientRow(row, ingredient.id);
      if (!isIngredientBlank(current) && !confirm("Remove this ingredient?")) return;
      mealIngredientDraft.splice(index, 1);
      renderIngredientBuilder();
    });
    els.ingredientList.append(row);
  });
  updateMealTotals();
}

function readIngredientRow(row, id = uid()) {
  const existing = mealIngredientDraft.find((ingredient) => ingredient.id === id) || {};
  const next = normalizeIngredient({
    ...existing,
    id,
    name: row.querySelector(".ingredient-name").value.trim(),
    servingMode: row.dataset.servingMode || existing.servingMode || "serving",
    servingCount: Number(row.querySelector(".ingredient-serving-count")?.value) || 1,
    weightAmount: Number(row.querySelector(".ingredient-weight-amount")?.value) || 0,
    weightUnit: row.querySelector(".ingredient-weight-unit")?.value || existing.weightUnit || "g",
    servingSize: servingSizeText({
      servingMode: row.dataset.servingMode || existing.servingMode || "serving",
      servingCount: Number(row.querySelector(".ingredient-serving-count")?.value) || 1,
      weightAmount: Number(row.querySelector(".ingredient-weight-amount")?.value) || 0,
      weightUnit: row.querySelector(".ingredient-weight-unit")?.value || existing.weightUnit || "g"
    }),
    barcode: row.querySelector(".ingredient-barcode")?.value.trim() || existing.barcode || "",
    calories: Number(row.querySelector(".ingredient-calories")?.value) || 0,
    protein: Number(row.querySelector(".ingredient-protein")?.value) || 0,
    carbs: Number(row.querySelector(".ingredient-carbs")?.value) || 0,
    fat: Number(row.querySelector(".ingredient-fat")?.value) || 0,
    fiber: Number(row.querySelector(".ingredient-fiber")?.value) || 0,
    sugar: Number(row.querySelector(".ingredient-sugar")?.value) || 0,
    sodium: Number(row.querySelector(".ingredient-sodium")?.value) || 0,
    potassium: Number(row.querySelector(".ingredient-potassium")?.value) || 0,
    photo: existing.photo || ""
  });
  return scaledIngredientForServing(next);
}

function syncIngredientDraftFromDom() {
  mealIngredientDraft = [...els.ingredientList.querySelectorAll(".ingredient-row")]
    .map((row, index) => readIngredientRow(row, mealIngredientDraft[index]?.id || uid()))
    .filter((ingredient) => !isIngredientBlank(ingredient));
}

function updateMealTotals() {
  const totals = mealTotals(mealIngredientDraft);
  els.mealTotals.textContent = `${number(totals.calories)} cal · ${number(totals.protein)}P ${number(totals.carbs)}C ${number(totals.fat)}F`;
}

function fallbackMealName() {
  return (
    document.querySelector("#mealName").value.trim() ||
    mealIngredientDraft.find((ingredient) => ingredient.name)?.name ||
    "Saved menu"
  );
}

function saveMealFromBuilder() {
  syncIngredientDraftFromDom();
  if (!mealIngredientDraft.length) {
    showToast("Add at least one ingredient");
    return;
  }
  const totals = mealTotals(mealIngredientDraft);
  const meal = {
    id: editingMealId || uid(),
    name: fallbackMealName(),
    category: els.mealCategory?.value || "lunch",
    ingredients: mealIngredientDraft,
    calories: totals.calories,
    protein: totals.protein,
    carbs: totals.carbs,
    fat: totals.fat,
    fiber: totals.fiber,
    sugar: totals.sugar,
    sodium: totals.sodium,
    potassium: totals.potassium,
    photo: pendingMealPhoto
  };
  if (editingMealId) {
    data.meals = data.meals.map((item) => (item.id === editingMealId ? meal : item));
    showToast("Meal updated");
  } else {
    data.meals.push(meal);
    showToast(`${meal.name} saved to Refrigerator`);
  }
  els.mealSearch.value = "";
  saveStore();
  resetEditors();
  render();
  requestAnimationFrame(() => {
    els.fridgePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function openProfileSheet() {
  if (els.profileSheet.classList.contains("open")) return;
  els.profileSheet.classList.add("open");
  els.profileSheet.setAttribute("aria-hidden", "false");
  lockBackgroundScroll();
}

function closeProfileSheet() {
  const wasOpen = els.profileSheet.classList.contains("open");
  els.profileSheet.classList.remove("open");
  els.profileSheet.setAttribute("aria-hidden", "true");
  if (wasOpen) unlockBackgroundScroll();
}

function switchToScreen(screen) {
  const tab = [...els.tabs].find((item) => item.dataset.screen === screen);
  if (!tab) return;
  els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
  els.screens.forEach((item) => item.classList.toggle("active", item.id === `${screen}Screen`));
  els.screenTitle.textContent = tab.dataset.title;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function addWeightEntry() {
  const input = document.querySelector("#weightValue");
  const unitInput = document.querySelector("#weightEntryUnit");
  const value = Number(input.value);
  if (!value) {
    input.classList.add("input-error");
    input.focus();
    showToast("Type your weight first");
    return;
  }
  input.classList.remove("input-error");
  data.settings.weightUnit = unitInput.value;
  const entryDate = document.querySelector("#weightDate").value || selectedFoodDate || today();
  data.weights.push({
    id: uid(),
    date: entryDate,
    value
  });
  selectedFoodDate = entryDate;
  centerDateStripOnSelected();
  els.weightForm.reset();
  setDefaultDates();
  unitInput.value = data.settings.weightUnit;
  saveData();
  showToast("Weight added");
}

function startLiftEdit(lift) {
  editingLiftId = lift.id;
  document.querySelector("#liftDate").value = lift.date;
  document.querySelector("#liftExercise").value = lift.exercise;
  document.querySelector("#liftSets").value = lift.sets;
  document.querySelector("#liftReps").value = lift.reps;
  document.querySelector("#liftWeight").value = lift.weight;
  document.querySelector("#liftForm .primary-button").textContent = "Save lift";
  document.querySelector("#liftExercise").focus();
  window.scrollTo({ top: document.querySelector("#liftForm").offsetTop - 8, behavior: "smooth" });
}

function resetLiftForm() {
  editingLiftId = null;
  els.liftForm.reset();
  document.querySelector("#liftSets").value = 3;
  document.querySelector("#liftReps").value = 8;
  document.querySelector("#liftForm .primary-button").textContent = "Add lift";
  setDefaultDates();
}

function openMenuBuilder() {
  resetEditors();
  els.mealForm.hidden = false;
  els.mealSheet?.classList.add("open");
  els.mealSheet?.setAttribute("aria-hidden", "false");
  lockBackgroundScroll();
  els.logFoodActions.hidden = true;
  quickMealPickerOpen = false;
  renderQuickMealPicker();
  document.querySelector("#mealName").focus();
}

function resetEditors() {
  const wasOpen = els.mealSheet?.classList.contains("open");
  editingMealId = null;
  pendingMealPhoto = "";
  mealIngredientDraft = [normalizeIngredient({ name: "", servingMode: "weight", weightUnit: "g", calories: 0, protein: 0, carbs: 0, fat: 0 })];
  document.querySelector("#mealFormTitle").textContent = "Create menu";
  document.querySelector("#cancelMealEdit").hidden = true;
  document.querySelector("#mealForm .primary-button").textContent = "Save menu";
  if (els.mealCategory) els.mealCategory.value = "lunch";
  els.mealForm.hidden = true;
  els.mealSheet?.classList.remove("open");
  els.mealSheet?.setAttribute("aria-hidden", "true");
  if (wasOpen) unlockBackgroundScroll();
  els.logFoodActions.hidden = true;
  if (els.savedMenuSearch) els.savedMenuSearch.value = "";
  quickMealPickerOpen = false;
  renderQuickMealPicker();
  els.mealForm.reset();
  setPhotoPreview(els.mealPhotoPreview, "");
  renderIngredientBuilder();
  setDefaultDates();
}

function startMealEdit(meal) {
  editingMealId = meal.id;
  document.querySelector("#mealFormTitle").textContent = "Edit menu";
  document.querySelector("#cancelMealEdit").hidden = false;
  document.querySelector("#mealForm .primary-button").textContent = "Save changes";
  document.querySelector("#mealName").value = meal.name;
  if (els.mealCategory) els.mealCategory.value = meal.category || "lunch";
  mealIngredientDraft = meal.ingredients.map(normalizeIngredient);
  renderIngredientBuilder();
  pendingMealPhoto = meal.photo || "";
  setPhotoPreview(els.mealPhotoPreview, pendingMealPhoto, () => {
    pendingMealPhoto = "";
    els.mealPhoto.value = "";
    showToast("Photo removed");
  });
  els.mealForm.hidden = false;
  els.mealSheet?.classList.add("open");
  els.mealSheet?.setAttribute("aria-hidden", "false");
  lockBackgroundScroll();
  switchToScreen("calories");
}

function useMeal(meal) {
  data.foods = Array.isArray(data.foods) ? data.foods.map(normalizeFoodLog) : [];
  data.foods.push(createFoodLogFromMeal(meal));
  quickMealPickerOpen = false;
  if (els.savedMenuSearch) els.savedMenuSearch.value = "";
  saveData();
  showToast(`${meal.name} added`);
}

function closeFoodLogSheet() {
  const wasOpen = els.foodLogSheet?.classList.contains("open");
  els.foodLogSheet?.classList.remove("open");
  els.foodLogSheet?.setAttribute("aria-hidden", "true");
  if (els.foodLogSheetPanel) els.foodLogSheetPanel.hidden = true;
  if (wasOpen) unlockBackgroundScroll();
}

function foodLogMenuRow(meal) {
  const row = document.createElement("button");
  row.className = "food-log-menu-row";
  row.type = "button";
  row.innerHTML = `
    <div>
      <strong></strong>
      <small></small>
    </div>
    <span>Add</span>
  `;
  row.querySelector("strong").textContent = meal.name;
  row.querySelector("small").textContent = `${number(meal.calories)} cal · ${number(meal.protein)}P ${number(meal.carbs)}C ${number(meal.fat)}F`;
  row.querySelector("span").textContent = "+";
  row.addEventListener("click", () => {
    useMeal(meal);
    closeFoodLogSheet();
  });
  return row;
}

function renderFoodLogSheet() {
  if (!els.foodLogMenuList) return;
  const categoryOptions = [{ id: "all", label: "All" }, ...menuSections];
  renderCategoryFilters(els.foodLogCategoryFilters, categoryOptions, selectedFoodLogCategory);
  const query = els.foodLogMenuSearch?.value.trim().toLowerCase() || "";
  const meals = data.meals.filter((meal) => {
    const text = `${meal.name} ${ingredientText(meal.ingredients)}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesCategory = selectedFoodLogCategory === "all" || (meal.category || "lunch") === selectedFoodLogCategory;
    return matchesQuery && matchesCategory;
  });
  if (els.foodLogMenuCount) {
    els.foodLogMenuCount.textContent = `${meals.length} ${meals.length === 1 ? "item" : "items"}`;
  }
  els.foodLogMenuList.innerHTML = "";
  if (!meals.length) {
    const activeCategory = categoryOptions.find((section) => section.id === selectedFoodLogCategory);
    const emptyText = query
      ? "No saved menus match."
      : selectedFoodLogCategory === "all"
        ? "No saved menus yet."
        : `No ${activeCategory?.label.toLowerCase() || "menus"} saved yet.`;
    els.foodLogMenuList.append(menuSectionEmpty(emptyText));
    return;
  }
  meals.forEach((meal) => els.foodLogMenuList.append(foodLogMenuRow(meal)));
}

function openFoodLogSheet() {
  if (els.foodLogSheet?.classList.contains("open")) return;
  if (els.foodLogSheetPanel) els.foodLogSheetPanel.hidden = false;
  els.foodLogSheet?.classList.add("open");
  els.foodLogSheet?.setAttribute("aria-hidden", "false");
  lockBackgroundScroll();
  requestAnimationFrame(() => {
    els.logFoodActions.hidden = true;
    if (els.savedMenuSearch) els.savedMenuSearch.value = "";
    quickMealPickerOpen = false;
    renderQuickMealPicker();
    if (els.foodLogMenuSearch) els.foodLogMenuSearch.value = "";
    selectedFoodLogCategory = "all";
    renderFoodLogSheet();
    const firstTarget = data.meals.length ? els.foodLogMenuSearch : els.customFoodName;
    firstTarget?.focus({ preventScroll: true });
  });
}

function hasCustomMacroInput() {
  return [els.customFoodProtein, els.customFoodCarbs, els.customFoodFat].some((input) => input?.value.trim() !== "");
}

function customMacroCalories() {
  const protein = Number(els.customFoodProtein?.value) || 0;
  const carbs = Number(els.customFoodCarbs?.value) || 0;
  const fat = Number(els.customFoodFat?.value) || 0;
  return Math.round((protein * 4) + (carbs * 4) + (fat * 9));
}

function syncCustomCaloriesFromMacros() {
  if (!els.customFoodCalculatedCalories) return;
  const calories = hasCustomMacroInput() ? customMacroCalories() : 0;
  els.customFoodCalculatedCalories.textContent = `Macro estimate: ${number(calories)} cal`;
}

function logCustomFood() {
  const name = els.customFoodName?.value.trim() || "Custom food";
  const manualCalories = Number(els.customFoodCalories?.value) || 0;
  const protein = Number(els.customFoodProtein?.value) || 0;
  const carbs = Number(els.customFoodCarbs?.value) || 0;
  const fat = Number(els.customFoodFat?.value) || 0;
  const calories = manualCalories || (hasCustomMacroInput() ? customMacroCalories() : 0);
  const draftNutrition = customFoodDraftNutrition || {};
  if (!calories && !protein && !carbs && !fat) {
    els.customFoodCalories?.focus();
    showToast("Add calories or macros first");
    return;
  }
  data.foods.push(normalizeFoodLog({
    date: selectedFoodDate,
    source: "custom",
    name,
    calories,
    protein,
    carbs,
    fat,
    fiber: Number(draftNutrition.fiber) || 0,
    sugar: Number(draftNutrition.sugar) || 0,
    sodium: Number(draftNutrition.sodium) || 0,
    potassium: Number(draftNutrition.potassium) || 0,
    barcode: els.customFoodBarcode?.value.trim() || "",
    baseNutrition: {
      calories,
      protein,
      carbs,
      fat,
      fiber: Number(draftNutrition.fiber) || 0,
      sugar: Number(draftNutrition.sugar) || 0,
      sodium: Number(draftNutrition.sodium) || 0,
      potassium: Number(draftNutrition.potassium) || 0
    },
    servingMode: "serving",
    servingCount: 1,
    baseServingAmount: 1,
    baseServingUnit: "serving"
  }));
  [els.customFoodName, els.customFoodBarcode, els.customFoodCalories, els.customFoodProtein, els.customFoodCarbs, els.customFoodFat].forEach((input) => {
    if (input) input.value = "";
  });
  customFoodDraftNutrition = null;
  syncCustomCaloriesFromMacros();
  saveData();
  closeFoodLogSheet();
  showToast(`${name} logged`);
}

function bindNavigation() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchToScreen(tab.dataset.screen));
  });
  els.calorieSummaryButton.addEventListener("click", () => switchToScreen("calories"));
  els.weightSummaryButton.addEventListener("click", () => switchToScreen("weight"));
  els.liftSummaryButton.addEventListener("click", () => switchToScreen("lifts"));
  els.streakSummaryButton?.addEventListener("click", () => switchToScreen("settings"));
}

function bindForms() {
  els.weightForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addWeightEntry();
  });
  document.querySelector("#weightValue").addEventListener("input", (event) => {
    event.target.classList.remove("input-error");
  });

  els.liftForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const lift = {
      id: editingLiftId || uid(),
      date: document.querySelector("#liftDate").value,
      exercise: document.querySelector("#liftExercise").value.trim(),
      sets: Number(document.querySelector("#liftSets").value),
      reps: Number(document.querySelector("#liftReps").value),
      weight: Number(document.querySelector("#liftWeight").value)
    };
    if (editingLiftId) {
      data.lifts = data.lifts.map((item) => (item.id === editingLiftId ? lift : item));
      showToast("Lift updated");
    } else {
      data.lifts.push(lift);
      showToast("Lift added");
    }
    resetLiftForm();
    saveData();
  });

  els.mealForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveMealFromBuilder();
  });
  els.saveMealButton.addEventListener("click", saveMealFromBuilder);

  els.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextSettings = {
      calorieGoal: Number(document.querySelector("#goalCalories").value) || data.settings.calorieGoal || defaultProfileData.settings.calorieGoal,
      proteinGoal: Number(document.querySelector("#goalProtein").value),
      carbGoal: Number(document.querySelector("#goalCarbs").value),
      fatGoal: Number(document.querySelector("#goalFat").value),
      weightUnit: document.querySelector("#weightUnit").value
    };
    data.settings = nextSettings;
    saveData();
    closeSettingsGoalSheet();
    showToast("Settings saved");
  });
  els.settingsGoalButton?.addEventListener("click", openSettingsGoalSheet);
  els.settingsGoalClose?.addEventListener("click", closeSettingsGoalSheet);
  els.settingsGoalSheet?.addEventListener("click", (event) => {
    if (event.target === els.settingsGoalSheet) closeSettingsGoalSheet();
  });
  ["#goalCalories", "#goalProtein", "#goalCarbs", "#goalFat"].forEach((selector) => {
    const input = document.querySelector(selector);
    input?.addEventListener("dblclick", () => input.select());
    input?.addEventListener("focus", (event) => {
      if (event.detail > 1) input.select();
    });
  });
  ["#goalCalories", "#goalProtein", "#goalCarbs", "#goalFat"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("input", renderMacroCalorieNotes);
  });
  document.querySelectorAll("[data-suggest-goal]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.suggestGoal;
      const suggestion = suggestedMacroGoal(target);
      const input = document.querySelector(`#goal${target[0].toUpperCase()}${target.slice(1)}`);
      if (!input || suggestion == null || !Number.isFinite(suggestion)) return;
      input.value = number(suggestion, 1).replace(/\.0$/, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
  });

  document.querySelector("#cancelMealEdit").addEventListener("click", resetEditors);
  els.mealSheet?.addEventListener("click", (event) => {
    if (event.target === els.mealSheet) resetEditors();
  });
  els.foodLogSheetClose?.addEventListener("click", closeFoodLogSheet);
  els.foodLogSheet?.addEventListener("click", (event) => {
    if (event.target === els.foodLogSheet) closeFoodLogSheet();
  });
  els.foodLogMenuSearch?.addEventListener("input", renderFoodLogSheet);
  els.foodLogCategoryFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    event.preventDefault();
    selectedFoodLogCategory = button.dataset.category || "all";
    renderFoodLogSheet();
  });
  [els.customFoodProtein, els.customFoodCarbs, els.customFoodFat].forEach((input) => {
    input?.addEventListener("input", syncCustomCaloriesFromMacros);
  });
  els.customFoodScanBarcode?.addEventListener("click", openCustomFoodBarcodeScanner);
  els.customFoodBarcodePhoto?.addEventListener("change", handleCustomFoodBarcodePhoto);
  els.customFoodBarcodeLookup?.addEventListener("click", () => lookupBarcodeForCustomFood(els.customFoodBarcode?.value));
  els.customFoodBarcode?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    lookupBarcodeForCustomFood(els.customFoodBarcode.value);
  });
  [els.customFoodName, els.customFoodCalories, els.customFoodProtein, els.customFoodCarbs, els.customFoodFat].forEach((input) => {
    input?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      logCustomFood();
    });
  });
  els.logCustomFoodButton?.addEventListener("click", logCustomFood);
  els.barcodeScannerClose?.addEventListener("click", closeBarcodeScanner);
  els.barcodeScanner?.addEventListener("click", (event) => {
    if (event.target === els.barcodeScanner) closeBarcodeScanner();
  });
  els.scannerLookupButton?.addEventListener("click", () => {
    lookupBarcodeFromScanner(els.scannerBarcodeInput.value);
  });
  els.scannerBarcodeInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    lookupBarcodeFromScanner(els.scannerBarcodeInput.value);
  });
  els.scannerPhotoButton?.addEventListener("click", () => {
    barcodeScanState.row?.querySelector(".ingredient-photo-input")?.click();
  });
  document.addEventListener("click", (event) => {
    const target = event.target.closest("#liftTimerTap, #liftTimerReset, #liftTimerPrevious, #liftTimerPause, #liftTimerSkip");
    if (!target) return;
    const actionMap = {
      liftTimerTap: "tap",
      liftTimerReset: "reset",
      liftTimerPrevious: "previous",
      liftTimerPause: "pause",
      liftTimerSkip: "skip"
    };
    handleLiftTimerAction(event, actionMap[target.id]);
  });
  els.liftTimerCard?.addEventListener("click", (event) => {
    if (event.target.closest("button, input, select, textarea, a")) return;
    handleLiftTimerTap();
  });
}

function bindCaloriesTools() {
  els.previousFoodWeek?.addEventListener("click", () => {
    selectedFoodDate = addDays(selectedFoodDate, -1);
    centerDateStripOnSelected();
    render();
  });
  els.nextFoodWeek?.addEventListener("click", () => {
    selectedFoodDate = addDays(selectedFoodDate, 1);
    centerDateStripOnSelected();
    render();
  });
  els.todayFoodButton?.addEventListener("click", () => {
    selectedFoodDate = today();
    centerDateStripOnSelected();
    render();
  });
  els.calendarJumpButton?.addEventListener("click", () => {
    openCalendarSheet();
  });
  els.foodDatePicker?.addEventListener("change", () => {
    selectedFoodDate = els.foodDatePicker.value || today();
    centerDateStripOnSelected();
    render();
  });
  document.addEventListener("click", (event) => {
    const switcher = event.target.closest("[data-date-switcher]");
    if (!switcher) return;
    const actionButton = event.target.closest("[data-date-action]");
    const dayButton = event.target.closest(".day-square[data-date]");
    if (actionButton?.dataset.dateAction === "previous") {
      selectedFoodDate = addDays(selectedFoodDate, -1);
      centerDateStripOnSelected();
      render();
    } else if (actionButton?.dataset.dateAction === "next") {
      selectedFoodDate = addDays(selectedFoodDate, 1);
      centerDateStripOnSelected();
      render();
    } else if (actionButton?.dataset.dateAction === "today") {
      selectedFoodDate = today();
      centerDateStripOnSelected();
      render();
    } else if (actionButton?.dataset.dateAction === "calendar") {
      openCalendarSheet();
    } else if (dayButton) {
      if (Date.now() < dateStripDragSuppressUntil) return;
      selectedFoodDate = dayButton.dataset.date;
      render();
    }
  });
  els.calendarSheet?.addEventListener("click", (event) => {
    if (event.target === els.calendarSheet) closeCalendarSheet();
  });
  els.calendarCloseButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeCalendarSheet();
  });
  els.calendarTodayButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectedFoodDate = today();
    centerDateStripOnSelected();
    calendarViewDate = selectedFoodDate;
    closeCalendarSheet();
    render();
  });
  els.calendarPrevMonth?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    calendarViewDate = addMonths(calendarViewDate, -1);
    renderCalendarSheet();
  });
  els.calendarNextMonth?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    calendarViewDate = addMonths(calendarViewDate, 1);
    renderCalendarSheet();
  });
  els.calendarSheetPanel?.addEventListener("pointerdown", (event) => {
    calendarSwipe = { x: event.clientX, y: event.clientY, active: true };
  });
  els.calendarSheetPanel?.addEventListener("pointerup", (event) => {
    if (!calendarSwipe.active) return;
    const deltaX = event.clientX - calendarSwipe.x;
    const deltaY = event.clientY - calendarSwipe.y;
    calendarSwipe.active = false;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    calendarViewDate = addMonths(calendarViewDate, deltaX < 0 ? 1 : -1);
    renderCalendarSheet();
  });
  els.calendarSheetPanel?.addEventListener("pointercancel", () => {
    calendarSwipe.active = false;
  });
  document.addEventListener("change", (event) => {
    const picker = event.target.closest("[data-date-picker]");
    if (!picker) return;
    selectedFoodDate = picker.value || today();
    centerDateStripOnSelected();
    render();
  });
  els.mealSearch.addEventListener("input", renderMeals);
  els.mealCategoryFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    event.preventDefault();
    selectedMealCategory = button.dataset.category || "all";
    renderMeals();
  });
  els.savedMenuSearch?.addEventListener("input", () => {
    quickMealPickerOpen = true;
    renderQuickMealPicker();
  });
  els.logFoodButton.addEventListener("click", () => {
    openFoodLogSheet();
  });
  els.addMenuButton.addEventListener("click", () => {
    openMenuBuilder();
  });
  els.fridgeAddMenuButton.addEventListener("click", openMenuBuilder);
  els.addIngredientButton.addEventListener("click", () => addIngredientRow());
  els.mealPhoto.addEventListener("change", async () => {
    const file = els.mealPhoto.files[0];
    if (!file) return;
    pendingMealPhoto = await compressImage(file);
    setPhotoPreview(els.mealPhotoPreview, pendingMealPhoto, () => {
      pendingMealPhoto = "";
      els.mealPhoto.value = "";
      showToast("Photo removed");
    });
    showToast("Meal photo added");
  });
  els.pantryInput.addEventListener("input", () => {
    data.pantryIngredients = els.pantryInput.value;
    saveStore();
    renderRecommendations();
  });
  els.rangeControls.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button) return;
    data.chart.range = button.dataset.range;
    saveData();
  });
  els.metricControls.forEach((button) => {
    button.addEventListener("click", () => {
      data.chart.metric = button.dataset.chartMetric;
      saveData();
    });
  });
  els.liftKeyToggles?.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-lift-key]");
    if (!input) return;
    data.chart.keyLifts = {
      ...defaultProfileData.chart.keyLifts,
      ...(data.chart.keyLifts || {}),
      [input.dataset.liftKey]: input.checked
    };
    saveData();
  });
}

function bindProfileActions() {
  els.profileButton.addEventListener("click", openProfileSheet);
  els.profileCloseButton.addEventListener("click", closeProfileSheet);
  els.profileSheet.addEventListener("click", (event) => {
    if (event.target === els.profileSheet) closeProfileSheet();
  });

  els.profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#profileName");
    const name = input.value.trim();
    if (!name) return;
    const profile = createProfile(name, cloneProfileData());
    store.profiles.push(profile);
    store.activeProfileId = profile.id;
    input.value = "";
    resetEditors();
    saveData();
    closeProfileSheet();
    showToast(`${name} profile added`);
  });
}

function bindDataActions() {
  els.exportDataButton?.addEventListener("click", () => {
    const activeProfile = getActiveProfile();
    const backup = {
      app: "Fitness App V1",
      version: 1,
      exportedAt: new Date().toISOString(),
      activeProfileId: store.activeProfileId,
      activeProfileName: activeProfile?.name || "Me",
      store
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = today();
    const link = document.createElement("a");
    link.href = url;
    link.download = `fitness-app-v1-backup-${stamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    localStorage.setItem(BACKUP_STATUS_KEY, new Date().toISOString());
    renderReadiness();
    showToast("Backup exported");
  });

  els.importDataInput?.addEventListener("change", async () => {
    const file = els.importDataInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const nextStore = parsed.store || parsed;
      if (!nextStore || !Array.isArray(nextStore.profiles) || !nextStore.profiles.length) {
        throw new Error("Invalid Fitness App V1 backup");
      }
      if (!confirm("Import this backup and replace the current local data?")) return;
      store = {
        activeProfileId: nextStore.activeProfileId || nextStore.profiles[0].id,
        profiles: nextStore.profiles.map((profile) => ({
          id: profile.id || uid(),
          name: profile.name || "Me",
          data: normalizeProfileData(profile.data || cloneProfileData())
        }))
      };
      if (!store.profiles.some((profile) => profile.id === store.activeProfileId)) {
        store.activeProfileId = store.profiles[0].id;
      }
      data = getActiveProfile().data;
      resetEditors();
      saveData();
      localStorage.setItem(BACKUP_STATUS_KEY, new Date().toISOString());
      showToast("Backup imported");
    } catch (error) {
      showToast("Could not import backup");
    } finally {
      els.importDataInput.value = "";
    }
  });

  els.clearButton.addEventListener("click", () => {
    if (!confirm("Clear this profile's fitness data?")) return;
    getActiveProfile().data = cloneProfileData();
    data = getActiveProfile().data;
    resetEditors();
    saveData();
    showToast("Profile data cleared");
  });
}

window.addEventListener("resize", drawProgressChart);
window.addEventListener("load", () => window.scrollTo(0, 0));
window.addEventListener("pagehide", () => saveStore());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveStore();
});
window.setInterval(() => {
  const currentDate = today();
  renderLiveDateTime();
  if (currentDate !== lastKnownDate) {
    if (selectedFoodDate === lastKnownDate) {
      selectedFoodDate = currentDate;
      centerDateStripOnSelected();
    }
    lastKnownDate = currentDate;
    render();
  }
}, 1000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(() => {
      renderReadiness();
    }).catch(() => {
      renderReadiness();
    });
  });
}

setDefaultDates();
bindStableViewportInteractions();
bindNavigation();
bindForms();
bindCaloriesTools();
bindProfileActions();
bindDataActions();
render();

const queryScreen = new URLSearchParams(window.location.search).get("screen");
const initialScreen = queryScreen || window.location.hash.replace("#", "");
if (initialScreen) {
  switchToScreen(initialScreen);
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("screen");
  cleanUrl.hash = "";
  window.history.replaceState({}, "", cleanUrl);
} else {
  switchToScreen("dashboard");
}
