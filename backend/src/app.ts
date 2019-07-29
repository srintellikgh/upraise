import "reflect-metadata";
import bodyParser from "body-parser";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createConnection, getManager } from "typeorm";
import config from "./config/config";
import routes from "./routes";
import cron from "cron";

// Import Services
import { AdditionalService } from "./services/additionals.service";
import { UserService } from "./services/users.service";
import { CurrencyService } from "./services/currency.service";
import { BillService } from "./services/bills.service";

// Import Entities
import { Currency } from "./entities/currency.entity";
import { User } from "./entities/user.entity";
import { Bill } from "./entities/bill.entity";
import { Additional } from "./entities/additional.entity";

// Import Utils
import * as swaggerDocument from "./utils/swagger/swagger.json";
import { Logger, ILogger } from "./utils/logger";

// Import Crons
import { CurrencyCron } from "./crons/currency.cron";

// Import Middlewares
import { AuthHandler } from "./middlewares/authHandler.middleware";
import genericErrorHandler from "./middlewares/genericErrorHandler.middleware";
import nodeErrorHandler from "./middlewares/nodeErrorHandler.middleware";
import notFoundHandler from "./middlewares/notFoundHandler.middleware";

export class Application {
  app: express.Application;
  config = config;
  logger: ILogger;
  CronJob = cron.CronJob;

  constructor() {
    this.logger = new Logger(__filename);
    this.app = express();

    this.app.use(require("express-status-monitor")());
    this.app.use(cors());
    this.app.use(helmet());
    this.app.use(
      morgan("dev", {
        skip: () => process.env.NODE_ENV === "test"
      })
    );
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
    this.app.use(new AuthHandler().initialize());

    this.app.use("/api", routes);
    this.app.use(
      "/api-docs",
      swaggerUi.serve,
      swaggerUi.setup(swaggerDocument)
    );
    this.app.use(genericErrorHandler);
    this.app.use(notFoundHandler);
  }

  setupDbAndServer = async () => {
    const conn = await createConnection();
    this.logger.info(
      `Connected to database. Connection: ${conn.name} / ${
        conn.options.database
      }`
    );

    await this.startServer();
    await this.setCurrencies();
    await this.setupCrons();
    await this.createAdmin();
  };

  startServer(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.app
        .listen(+this.config.port, this.config.host, () => {
          this.logger.info(
            `Server started at http://${this.config.host}:${this.config.port}`
          );
          resolve(true);
        })
        .on("error", nodeErrorHandler);
    });
  }

  createAdmin = async () => {
    const userService = new UserService();
    const billService = new BillService();
    const curencyService = new CurrencyService();
    const additionalService = new AdditionalService();
    const userRepository = getManager().getRepository(User);
    const billRepository = getManager().getRepository(Bill);
    const additionalRepository = getManager().getRepository(Additional);
    const currency = await curencyService.getById(1);

    try {
      const admin = await userService.getByLogin(this.config.admin.login);
      if (admin) return;

      let user = new User();
      user.name = this.config.admin.name;
      user.surname = this.config.admin.surname;
      user.email = this.config.admin.email;
      user.login = this.config.admin.login;
      user.password = this.config.admin.password;
      user = userRepository.create(user);
      user = await userService.insert(user);

      let bill = new Bill();
      bill.user = userRepository.getId(user);
      bill.accountBill = await billService.generateAccountBill();
      bill.currency = currency;
      bill = billRepository.create(bill);
      await billService.insert(bill);

      let additional = new Additional();
      additional.user = userRepository.getId(user);
      additional = additionalRepository.create(additional);
      await additionalService.insert(additional);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  setCurrencies = async () => {
    const currencyService = new CurrencyService();
    const currencyRepository = getManager().getRepository(Currency);
    const newCurrencies: Array<object> = [
      { id: 1, name: "USD" },
      { id: 2, name: "PLN", main: true },
      { id: 3, name: "EUR" }
    ];

    try {
      const currencies = await currencyService.getAll();

      if (currencies.length)
        return new CurrencyCron().setCurrenciesExchangeRates();

      newCurrencies.map(async (newCurrency: Currency) => {
        let currency = new Currency();
        currency.id = newCurrency.id;
        currency.name = newCurrency.name;
        currency.main = newCurrency.main;
        currency = currencyRepository.create(currency);
        await currencyService.insert(currency);
      });

      return new CurrencyCron().setCurrenciesExchangeRates();
    } catch (error) {
      return Promise.reject(error);
    }
  };

  setupCrons = () => {
    new this.CronJob(
      "0 0 */1 * * *",
      () => new CurrencyCron().setCurrenciesExchangeRates(),
      null,
      true,
      "Poland"
    );
  };
}
