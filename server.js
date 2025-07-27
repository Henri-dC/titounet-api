require("dotenv").config();
const express = require("express");
const cors = require("cors");
const WooCommerceAPI = require("woocommerce-api");
const axios = require("axios");
const multer = require("multer");
const FormData = require("form-data");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration de WooCommerce API
const wooApi = new WooCommerceAPI({
  url: process.env.WOO_API_URL || "https://www.tontonriton.com", // Remplacez par l'URL de votre site WordPress/WooCommerce
  consumerKey: process.env.WOO_CONSUMER_KEY,
  consumerSecret: process.env.WOO_CONSUMER_SECRET,
  version: "wc/v3",
  // queryStringAuth: true, // Désactivé explicitement
  timeout: 10000, // Ajout d'un timeout de 10 secondes
});

// Nodemailer transporter setup

const MailjetTransport = require("nodemailer-mailjet-transport");
const transporter = nodemailer.createTransport(
  MailjetTransport({
    auth: {
      apiKey: process.env.MAILJET_API_KEY,
      apiSecret: process.env.MAILJET_SECRET_KEY,
    },
  })
);

console.log("MAILJET_API_KEY is defined:", !!process.env.MAILJET_API_KEY);
console.log("MAILJET_SECRET_KEY is defined:", !!process.env.MAILJET_SECRET_KEY);

console.log("WooCommerce API Config:", wooApi.options); // Log the config

// Configuration de l'API WordPress (pour les articles et médias)
const WP_API_URL = process.env.WOO_API_URL
  ? `${process.env.WOO_API_URL}/wp-json`
  : "https://www.tontonriton.com/wp-json";
const WP_USERNAME = process.env.WP_USERNAME; // Utilisateur de l'API REST WordPress
const WP_PASSWORD = process.env.WP_PASSWORD; // Mot de passe de l'application ou du compte

// Configuration de Multer pour l'upload de fichiers
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors()); // Permet les requêtes cross-origin depuis votre frontend Vue.js
app.use(express.json()); // Permet de parser les requêtes JSON

// Route de test
app.get("/", (req, res) => {
  res.send("Backend Titounet est en marche !");
});

// Endpoint pour créer une commande WooCommerce
app.post("/api/orders", (req, res) => {
  console.log("Received request to create order.");
  const orderData = req.body;

  wooApi.post("orders", orderData, (err, data, resWoo) => {
    console.log("WooCommerce API response received.");
    if (err) {
      console.error(
        "Erreur WooCommerce lors de la création de commande:",
        err.message || err,
        err.stack
      );
      return res.status(500).json({
        error: "Erreur lors de la création de la commande",
        details: err.message || err,
      });
    }

    try {
      // La documentation de woocommerce-api indique que `data` est le corps de la réponse sous forme de chaîne.
      const orderResponse = JSON.parse(data);

      // Envoyer la réponse au client immédiatement pour éviter les timeouts.
      // Le code 201 "Created" est plus approprié pour un POST qui crée une ressource.
      res.status(201).json(orderResponse);
      console.log(
        `Successfully sent 201 response for order #${orderResponse.id}.`
      );

      // Ensuite, envoyer l'e-mail de confirmation en arrière-plan.
      console.log("Attempting to send confirmation email in the background...");
      const mailOptions = {
        from: process.env.MAIL_FROM,
        to: orderData.billing.email,
        subject: "Confirmation de votre commande Titounet",
        html: `
          <h1>Merci pour votre commande !</h1>
          <p>Votre commande #${
            orderResponse.id
          } a été reçue et est en cours de traitement.</p>
          <p>Détails de la commande:</p>
          <ul>
            ${(orderResponse.line_items || [])
              .map(
                (item) =>
                  `<li>${item.name} (x${item.quantity}) - ${item.total} €</li>`
              )
              .join("")}
          </ul>
          <p>Total: ${orderResponse.total} €</p>
          <p>Nous vous contacterons bientôt pour les détails de livraison.</p>
          <p>Cordialement,<br>L'équipe Titounet</p>
        `,
      };

      // Utiliser un callback pour ne pas bloquer la réponse.
      transporter.sendMail(mailOptions, (emailError, info) => {
        if (emailError) {
          console.error(
            "Erreur lors de l'envoi de l'email de confirmation en arrière-plan:",
            emailError
          );
          return;
        }
        console.log("Email de confirmation envoyé avec succès:", info.response);
      });
    } catch (parseError) {
      console.error(
        "Erreur lors du parsing de la réponse WooCommerce:",
        parseError
      );
      // Si la réponse n'a pas encore été envoyée, envoyer une erreur.
      if (!res.headersSent) {
        res.status(500).json({
          error: "Erreur lors du traitement de la réponse de la commande",
          details: parseError.message,
        });
      }
    }
  });
});

// --- Authentification (simple pour la démo, à remplacer par un système robuste) ---
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;

  // !!! REMPLACEZ CECI PAR VOTRE LOGIQUE D'AUTHENTIFICATION RÉELLE !!!
  // Par exemple, vérifier un utilisateur dans une base de données ou via l'API WordPress
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    // En production, générez un jeton JWT ici
    res
      .status(200)
      .json({ message: "Connexion réussie", token: "fake-jwt-token" });
  } else {
    res.status(401).json({ message: "Identifiants incorrects" });
  }
});

// --- Endpoint pour créer un produit WooCommerce (appelant une route custom) ---
app.post("/api/products", async (req, res) => {
  const productData = req.body;
  const customProductCreateUrl = `${process.env.WOO_API_URL}/wp-json/custom/v1/create-product`;
  console.log("URL appelée :", customProductCreateUrl);
  console.log("Backend: Received request to create products.");

  try {
    const response = await axios.post(customProductCreateUrl, productData, {
      auth: {
        username: process.env.WOO_CONSUMER_KEY,
        password: process.env.WOO_CONSUMER_SECRET,
      },
    });
    res.status(201).json(response.data);
  } catch (error) {
    console.error(
      "Erreur lors de la création du produit via la route custom (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la création du produit via la route custom",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour récupérer tous les produits WooCommerce (avec Axios) ---
app.get("/api/products", async (req, res) => {
  console.log("Backend: Received request to fetch products.");
  try {
    const wooCommerceProductsUrl = `${process.env.WOO_API_URL}/wp-json/wc/v3/products`;
    console.log(
      "Backend: Attempting to fetch products from WooCommerce URL:",
      wooCommerceProductsUrl
    );
    const response = await axios.get(wooCommerceProductsUrl, {
      auth: {
        username: process.env.WOO_CONSUMER_KEY,
        password: process.env.WOO_CONSUMER_SECRET,
      },
    });
    console.log("Backend: Successfully fetched products from WooCommerce.");
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération des produits (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération des produits",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour récupérer un produit WooCommerce spécifique ---
app.get("/api/products/:id", async (req, res) => {
  console.log("Backend: Received request to fetch single product.");
  try {
    const productId = req.params.id;
    const wooCommerceProductUrl = `${process.env.WOO_API_URL}/wp-json/wc/v3/products/${productId}`;
    console.log(
      "Backend: Attempting to fetch product from WooCommerce URL:",
      wooCommerceProductUrl
    );
    const response = await axios.get(wooCommerceProductUrl, {
      auth: {
        username: process.env.WOO_CONSUMER_KEY,
        password: process.env.WOO_CONSUMER_SECRET,
      },
    });
    console.log(
      "Backend: Successfully fetched single product from WooCommerce."
    );
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération du produit (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération du produit",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour mettre à jour un produit WooCommerce ---
app.put("/api/products/:id", (req, res) => {
  const productId = req.params.id;
  const productData = req.body;

  wooApi.put(`products/${productId}`, productData, (err, data, resWoo) => {
    if (err) {
      console.error("Erreur WooCommerce:", err);
      return res.status(500).json({
        error: "Erreur lors de la mise à jour du produit",
        details: err,
      });
    }
    const parsedRes = JSON.parse(resWoo);
    res.status(200).json(parsedRes);
  });
});

// --- Endpoint pour supprimer un produit WooCommerce ---
app.delete("/api/products/:id", (req, res) => {
  const productId = req.params.id;

  wooApi.delete(
    `products/${productId}`,
    { force: true },
    (err, data, resWoo) => {
      if (err) {
        console.error("Erreur WooCommerce:", err);
        return res.status(500).json({
          error: "Erreur lors de la suppression du produit",
          details: err,
        });
      }
      const parsedRes = JSON.parse(resWoo);
      res.status(200).json(parsedRes);
    }
  );
});

// --- Endpoint pour télécharger un média WordPress ---
app.post("/api/media", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Aucun fichier fourni" });
  }

  const formData = new FormData();
  formData.append("file", req.file.buffer, req.file.originalname);

  try {
    const response = await axios.post(`${WP_API_URL}/wp/v2/media`, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Basic ${Buffer.from(
          `${WP_USERNAME}:${WP_PASSWORD}`
        ).toString("base64")}`,
      },
    });
    res.status(201).json(response.data);
  } catch (error) {
    console.error(
      "Erreur lors du téléchargement du média:",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors du téléchargement du média",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour récupérer les catégories de produits WooCommerce (avec Axios) ---
app.get("/api/product-categories", async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.WOO_API_URL}/wp-json/wc/v3/products/categories`,
      {
        auth: {
          username: process.env.WOO_CONSUMER_KEY,
          password: process.env.WOO_CONSUMER_SECRET,
        },
      }
    );
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des catégories de produits (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération des catégories de produits",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour récupérer les catégories de produits WooCommerce (avec Axios) ---
app.get("/api/product-categories", async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.WOO_API_URL}/wp-json/wc/v3/products/categories`,
      {
        auth: {
          username: process.env.WOO_CONSUMER_KEY,
          password: process.env.WOO_CONSUMER_SECRET,
        },
      }
    );
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des catégories de produits (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération des catégories de produits",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour récupérer tous les articles WordPress ---
app.get("/api/articles", async (req, res) => {
  try {
    const response = await axios.get(`${WP_API_URL}/wp/v2/posts`, {
      params: req.query, // Passer les paramètres de requête du frontend
      auth: {
        username: WP_USERNAME,
        password: WP_PASSWORD,
      },
    });
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération des articles (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération des articles",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour récupérer un article WordPress spécifique ---
app.get("/api/articles/:id", async (req, res) => {
  try {
    const articleId = req.params.id;
    const response = await axios.get(`${WP_API_URL}/wp/v2/posts/${articleId}`, {
      params: req.query, // Passer les paramètres de requête du frontend
      auth: {
        username: WP_USERNAME,
        password: WP_PASSWORD,
      },
    });
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération de l'article (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération de l'article",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour récupérer tous les médias WordPress ---
app.get("/api/media", async (req, res) => {
  try {
    const response = await axios.get(`${WP_API_URL}/wp/v2/media`, {
      params: req.query, // Passer les paramètres de requête du frontend
      auth: {
        username: WP_USERNAME,
        password: WP_PASSWORD,
      },
    });
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération des médias (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération des médias",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour récupérer les médias par catégorie ---
app.get("/api/media/category/:slug", async (req, res) => {
  const categorySlug = req.params.slug;

  if (!categorySlug) {
    return res
      .status(400)
      .json({ error: "Le slug de la catégorie est requis" });
  }

  try {
    const mediaResponse = await axios.get(`${WP_API_URL}/wp/v2/media`, {
      params: {
        attachment_category: categorySlug, // <-- CORRECTION : Utilise attachment_category avec le slug
        ...req.query, // Transmet tous les autres paramètres de requête du frontend (per_page, _embed, etc.)
      },
      auth: {
        username: WP_USERNAME,
        password: WP_PASSWORD,
      },
    });

    res.status(200).json(mediaResponse.data);
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des médias par catégorie:",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération des médias par catégorie",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur backend démarré sur le port ${PORT}`);
});
