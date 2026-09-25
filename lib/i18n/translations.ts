export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const dictionaries = {
  en: {
    locale: "en",
    units: { cm3: "cm³", mm: "mm" },
    meta: {
      titleSuffix: "Instant 3D Print Quotes",
      description:
        "Upload a 3D model, get an instant quote, and order professional 3D printed parts.",
    },
    header: {
      getQuote: "Get a quote",
      admin: "Admin",
    },
    home: {
      tag: "3D Print On Demand",
      title: "Upload a model. Get an instant quote.",
      subtitle:
        "Drag and drop an STL or OBJ file, pick a material and finish, and see your price update in real time. Order in minutes, track it through production.",
      cta: "Get an instant quote",
      step1Title: "1. Upload",
      step1Text: "Drop in your STL or OBJ file. We analyze volume and dimensions automatically.",
      step2Title: "2. Configure",
      step2Text: "Preview your model in 3D, choose material, color, finish, and quantity.",
      step3Title: "3. Order",
      step3Text: "Pay securely and track your order from queue to shipped.",
      aboutTag: "Why us",
      aboutTitle: "Production-grade 3D printing, quoted instantly",
      aboutText:
        "No sales calls, no waiting for a human to eyeball your file. Upload a model and the price, volume, and dimensions are calculated the moment it lands — the same numbers we actually charge and produce against.",
      features: [
        {
          title: "Automatic pricing",
          text: "Volume, bounding box, and cost computed the instant you upload — no back-and-forth quotes.",
        },
        {
          title: "Real material catalog",
          text: "Choose from resins, engineering plastics, and nylon — each with its own colors and finishes.",
        },
        {
          title: "An API, not just a form",
          text: "Every order and material is a clean JSON endpoint, ready to plug into your own production tooling.",
        },
      ],
      statsMaterialsLabel: "materials available",
      statsOrdersLabel: "orders placed",
      statsTurnaroundLabel: "fastest turnaround",
      materialsTag: "Materials",
      materialsTitle: "%d types of plastic for any task",
      materialsPricePrefix: "from",
      materialsPriceSuffix: "/ cm³",
      materialsLeadTime: "~%d",
      materialsBestFor: "Best for:",
      materialsStrength: "Strength",
      materialsFlexibility: "Flexibility",
      materialsHeatResistance: "Heat resistance",
      teasers: [
        {
          href: "/order/upload",
          title: "Get an instant quote",
          text: "Upload an STL or OBJ and see your price in seconds.",
        },
      ],
      showcaseLabel: "Our work",
      showcaseEmpty: "Coming soon",
    },
    upload: {
      title: "Upload your model",
      subtitle: "Supported formats: STL, OBJ. Max 500MB.",
      dropTitle: "Drag & drop your file here",
      dropSubtitle: "or click to browse",
      uploading: "Uploading and analyzing…",
      errorFallback: "Upload failed. Please try again.",
    },
    configure: {
      volume: "Volume",
      boundingBox: "Bounding box",
      file: "File",
      title: "Configure your part",
      material: "Material",
      color: "Color",
      finish: "Finish",
      quantity: "Quantity",
      estimatedTotal: "Estimated total",
      perUnit: "unit",
      shipsIn: "ships in ~%d",
      continueToCheckout: "Continue to checkout",
      noMaterials: "No materials available.",
      analyzing: "Still analyzing your file — refresh in a moment.",
      errorTitle: "Couldn't analyze this file",
    },
    checkout: {
      title: "Checkout",
      orderTotal: "Order total",
      email: "Email",
      fullName: "Full name",
      address: "Address",
      city: "City",
      postal: "Postal code",
      country: "Country",
      payNow: "Place order",
      redirecting: "Placing your order…",
    },
    thankYou: {
      title: "Order received",
      message: "Thanks — we've got your order and will reach out about payment and next steps shortly.",
      backHome: "Back to home",
    },
    login: {
      title: "Sign in",
      usernameLabel: "Username or email",
      passwordLabel: "Password",
      signIn: "Sign in",
      invalidCredentials: "Invalid email or password",
    },
    admin: {
      saving: "Saving…",
      showcaseTitle: "Showcase works",
      showcaseHint: "Photos of finished prints shown on the homepage.",
      workTitleLabel: "Title",
      workImageLabel: "Image",
      addWork: "Add work",
      deleteWork: "Delete",
      noWorks: "No works added yet.",
      materialImagesTitle: "Material images",
      materialImagesHint: "Illustrations shown when a customer picks a material.",
      uploadImage: "Upload image",
      replaceImage: "Replace image",
      removeImage: "Remove",
      colorsTitle: "Colors",
      colorNameLabel: "Color name (Russian)",
      colorEnPreview: "English name",
      colorEnUnknown: "no translation yet — the Russian name will be shown",
      addColor: "Add color",
      deleteColor: "Delete color",
      noColors: "No colors yet.",
      colorSaveError: "Could not save the color.",
      pricingTitle: "Pricing",
      pricingHint:
        "Price = max(minimum price, volume × price per cm³ × finish multiplier) + setup fee. Prices are set in rubles; the English site shows them in dollars at the configured rate. Changes apply to new quotes immediately.",
      pricePerCm3Label: "Price per cm³ (₽)",
      setupFeeLabel: "Setup fee (₽)",
      minPriceLabel: "Minimum price (₽)",
      leadTimeLabel: "Lead time (business days)",
      activeLabel: "Available to customers",
      finishMultipliersLabel: "Finish multipliers",
      savePricing: "Save",
      pricingSaved: "Saved",
      pricingInvalid: "Check the values — numbers only, no negatives.",
    },
  },
  ru: {
    locale: "ru",
    units: { cm3: "см³", mm: "мм" },
    meta: {
      titleSuffix: "Мгновенный расчёт 3D-печати",
      description:
        "Загрузите 3D-модель, получите мгновенный расчёт цены и закажите профессиональную 3D-печать.",
    },
    header: {
      getQuote: "Рассчитать цену",
      admin: "Админка",
    },
    home: {
      tag: "3D-печать на заказ",
      title: "Загрузите модель. Получите цену мгновенно.",
      subtitle:
        "Перетащите файл STL или OBJ, выберите материал и финиш — цена пересчитается в реальном времени. Оформите заказ за пару минут и следите за производством.",
      cta: "Рассчитать цену",
      step1Title: "1. Загрузка",
      step1Text: "Загрузите файл STL или OBJ — мы автоматически посчитаем объём и габариты.",
      step2Title: "2. Настройка",
      step2Text: "Просмотрите модель в 3D, выберите материал, цвет, финиш и количество.",
      step3Title: "3. Заказ",
      step3Text: "Оплатите онлайн и следите за статусом заказа от очереди до отправки.",
      aboutTag: "Почему мы",
      aboutTitle: "Промышленная 3D-печать с мгновенным расчётом цены",
      aboutText:
        "Без звонков менеджеру и ожидания, пока кто-то посмотрит ваш файл. Загружаете модель — и сразу видите цену, объём и габариты. Это те же цифры, по которым мы берём оплату и запускаем печать.",
      features: [
        {
          title: "Автоматический расчёт цены",
          text: "Объём, габариты и стоимость считаются в момент загрузки — без переписки и ожидания ответа.",
        },
        {
          title: "Реальный каталог материалов",
          text: "Смолы, инженерные пластики и нейлон — у каждого свои цвета и финиши.",
        },
        {
          title: "API, а не просто форма",
          text: "Каждый заказ и материал доступны как чистый JSON-эндпоинт — подключайте к своей системе производства.",
        },
      ],
      statsMaterialsLabel: "материалов в наличии",
      statsOrdersLabel: "оформленных заказов",
      statsTurnaroundLabel: "минимальный срок",
      materialsTag: "Материалы",
      materialsTitle: "%d видов пластика под любую задачу",
      materialsPricePrefix: "от",
      materialsPriceSuffix: "/ см³",
      materialsLeadTime: "~%d",
      materialsBestFor: "Подходит для:",
      materialsStrength: "Прочность",
      materialsFlexibility: "Гибкость",
      materialsHeatResistance: "Термостойкость",
      teasers: [
        {
          href: "/order/upload",
          title: "Рассчитать цену",
          text: "Загрузите STL или OBJ и узнайте цену за секунды.",
        },
      ],
      showcaseLabel: "Наши работы",
      showcaseEmpty: "Скоро здесь",
    },
    upload: {
      title: "Загрузите модель",
      subtitle: "Поддерживаемые форматы: STL, OBJ. До 500 МБ.",
      dropTitle: "Перетащите файл сюда",
      dropSubtitle: "или нажмите, чтобы выбрать",
      uploading: "Загружаем и анализируем…",
      errorFallback: "Не удалось загрузить файл. Попробуйте ещё раз.",
    },
    configure: {
      volume: "Объём",
      boundingBox: "Габариты",
      file: "Файл",
      title: "Настройте деталь",
      material: "Материал",
      color: "Цвет",
      finish: "Финиш",
      quantity: "Количество",
      estimatedTotal: "Итоговая цена",
      perUnit: "шт.",
      shipsIn: "отправка через ~%d",
      continueToCheckout: "Перейти к оформлению",
      noMaterials: "Нет доступных материалов.",
      analyzing: "Файл ещё анализируется — обновите страницу через момент.",
      errorTitle: "Не удалось обработать файл",
    },
    checkout: {
      title: "Оформление заказа",
      orderTotal: "Сумма заказа",
      email: "Email",
      fullName: "Имя и фамилия",
      address: "Адрес",
      city: "Город",
      postal: "Индекс",
      country: "Страна",
      payNow: "Оформить заказ",
      redirecting: "Оформляем заказ…",
    },
    thankYou: {
      title: "Заказ принят",
      message: "Спасибо — мы получили ваш заказ и скоро свяжемся насчёт оплаты и дальнейших шагов.",
      backHome: "На главную",
    },
    login: {
      title: "Вход",
      usernameLabel: "Логин или email",
      passwordLabel: "Пароль",
      signIn: "Войти",
      invalidCredentials: "Неверный логин или пароль",
    },
    admin: {
      saving: "Сохраняем…",
      showcaseTitle: "Наши работы",
      showcaseHint: "Фото готовых изделий, которые показываются на главной странице.",
      workTitleLabel: "Название",
      workImageLabel: "Изображение",
      addWork: "Добавить работу",
      deleteWork: "Удалить",
      noWorks: "Работы пока не добавлены.",
      materialImagesTitle: "Картинки материалов",
      materialImagesHint: "Иллюстрации, которые видит клиент при выборе материала.",
      uploadImage: "Загрузить картинку",
      replaceImage: "Заменить картинку",
      removeImage: "Убрать",
      colorsTitle: "Цвета",
      colorNameLabel: "Название цвета",
      colorEnPreview: "Английское название",
      colorEnUnknown: "перевода нет — на английском сайте останется русское название",
      addColor: "Добавить цвет",
      deleteColor: "Удалить цвет",
      noColors: "Цветов пока нет.",
      colorSaveError: "Не удалось сохранить цвет.",
      pricingTitle: "Цены",
      pricingHint:
        "Цена = max(минимальная цена, объём × цена за см³ × коэффициент финиша) + стоимость запуска. Цены задаются в рублях; английская версия сайта показывает их в долларах по заданному курсу. Изменения сразу действуют на новые расчёты.",
      pricePerCm3Label: "Цена за см³ (₽)",
      setupFeeLabel: "Запуск (₽)",
      minPriceLabel: "Минимальная цена (₽)",
      leadTimeLabel: "Срок (рабочих дней)",
      activeLabel: "Доступен клиентам",
      finishMultipliersLabel: "Коэффициенты финишей",
      savePricing: "Сохранить",
      pricingSaved: "Сохранено",
      pricingInvalid: "Проверьте значения — только числа, без отрицательных.",
    },
  },
} as const satisfies Record<Locale, unknown>;

export type Dictionary = (typeof dictionaries)[Locale];

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** "business day" in the right form for n (Russian has three plural forms). */
export function daysWord(n: number, locale: Locale): string {
  if (locale === "en") return n === 1 ? "business day" : "business days";
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "рабочих дней";
  if (last === 1) return "рабочий день";
  if (last >= 2 && last <= 4) return "рабочих дня";
  return "рабочих дней";
}

export function formatDays(n: number, locale: Locale): string {
  return `${n} ${daysWord(n, locale)}`;
}

export function formatTemplate(template: string, value: number | string): string {
  return template.replace("%d", String(value));
}
