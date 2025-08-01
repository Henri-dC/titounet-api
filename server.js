require("dotenv").config();
const express = require("express");
const cors = require("cors");
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const axios = require("axios");
const multer = require("multer");
const FormData = require("form-data");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration de WooCommerce API
const wooApi = new WooCommerceRestApi({
  url: process.env.WOO_API_URL || "https://www.tontonriton.com", // Remplacez par l'URL de votre site WordPress/WooCommerce
  consumerKey: process.env.WOO_CONSUMER_KEY,
  consumerSecret: process.env.WOO_CONSUMER_SECRET,
  version: "wc/v3",
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
app.post("/api/orders", async (req, res) => {
  console.log("Received request to create order.");
  const orderData = req.body;

  try {
    const { data: orderResponse } = await wooApi.post("orders", orderData);
    console.log("WooCommerce API response received.");

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
  } catch (error) {
    console.error(
      "Erreur WooCommerce lors de la création de commande:",
      error.response?.data || error.message,
      error.stack
    );
    res.status(500).json({
      error: "Erreur lors de la création de la commande",
      details: error.response?.data || error.message,
    });
  }
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

// --- Endpoint pour créer un produit WooCommerce ---
app.post("/api/products", async (req, res) => {
  console.log("Backend: Received request to create product.");
  const productData = req.body;

  try {
    const { data } = await wooApi.post("products", productData);
    console.log("Backend: Successfully created product.");
    res.status(201).json(data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la création du produit:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la création du produit",
      details: error.response?.data || error.message,
    });
  }
});

// --- Endpoint pour créer un produit WooCommerce (appelant une route custom) ---
/*
app.post("/api/products", async (req, res) => {
  const productData = req.body;
  const customProductCreateUrl = `${process.env.WOO_API_URL}/wp-json/custom/v1/create-product`;
  console.log("URL appelée :", customProductCreateUrl);
  console.log("Backend: Received request to create products.");

  try {
    const response = await axios.post(customProductCreateUrl, productData);
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
*/

// --- Endpoint pour mettre à jour un produit WooCommerce (route custom commentée) ---
/*
app.put("/api/products/:id/custom-update", async (req, res) => {
  const productId = req.params.id;
  const productData = req.body;
  const customProductUpdateUrl = `${WP_API_URL}/custom/v1/update-product/${productId}`;
  console.log("URL appelée :", customProductUpdateUrl);
  console.log(
    `Backend: Received request to update product ${productId} via custom route.`
  );

  try {
    const response = await axios.put(customProductUpdateUrl, productData);
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Erreur lors de la mise à jour du produit via la route custom (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la mise à jour du produit via la route custom",
      details: error.response ? error.response.data : error.message,
    });
  }
});
*/

// --- Endpoint pour récupérer tous les produits WooCommerce (avec Axios) ---
app.get("/api/products", async (req, res) => {
  console.log("Backend: Received request to fetch products.");
  try {
    const params = { ...req.query };
    if (params.per_page) {
      params.per_page = parseInt(params.per_page, 10);
    }
    if (params.page) {
      params.page = parseInt(params.page, 10);
    }
    const { data } = await wooApi.get("products", params);
    console.log("Backend: Successfully fetched products from WooCommerce.");
    res.status(200).json(data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération des produits:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération des produits",
      details: error.response?.data || error.message,
    });
  }
});

// --- Endpoint pour récupérer un produit WooCommerce spécifique ---
app.get("/api/products/:id", async (req, res) => {
  console.log("Backend: Received request to fetch single product.");
  try {
    const productId = req.params.id;
    const { data } = await wooApi.get(`products/${productId}`);
    console.log(
      "Backend: Successfully fetched single product from WooCommerce."
    );
    res.status(200).json(data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération du produit:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération du produit",
      details: error.response?.data || error.message,
    });
  }
});

// --- Endpoint pour mettre à jour un produit WooCommerce ---
app.put("/api/products/:id", async (req, res) => {
  const productId = req.params.id;
  const productData = req.body;

  try {
    const { data } = await wooApi.put(`products/${productId}`, productData);
    res.status(200).json(data);
  } catch (error) {
    console.error(
      "Erreur lors de la mise à jour du produit:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la mise à jour du produit",
      details: error.response?.data || error.message,
    });
  }
});

// --- Endpoint pour supprimer un produit WooCommerce ---
app.delete("/api/products/:id", async (req, res) => {
  const productId = req.params.id;

  try {
    const { data } = await wooApi.delete(`products/${productId}`, { force: true });
    res.status(200).json(data);
  } catch (error) {
    console.error(
      "Erreur lors de la suppression du produit:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la suppression du produit",
      details: error.response?.data || error.message,
    });
  }
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
    const params = { ...req.query };
    if (params.per_page) {
      params.per_page = parseInt(params.per_page, 10);
    }
    if (params.page) {
      params.page = parseInt(params.page, 10);
    }
    const { data } = await wooApi.get("products/categories", params);
    res.status(200).json(data);
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des catégories de produits:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération des catégories de produits",
      details: error.response?.data || error.message,
    });
  }
});

// --- Endpoint pour récupérer les catégories de produits WooCommerce (avec Axios) ---
app.get("/api/product-categories", async (req, res) => {
  try {
    const params = { ...req.query };
    if (params.per_page) {
      params.per_page = parseInt(params.per_page, 10);
    }
    if (params.page) {
      params.page = parseInt(params.page, 10);
    }
    const { data } = await wooApi.get("products/categories", params);
    res.status(200).json(data);
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des catégories de produits:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération des catégories de produits",
      details: error.response?.data || error.message,
    });
  }
});

// --- Endpoint pour récupérer les catégories de médias (attachment_category) ---
app.get("/api/media_category", async (req, res) => {
  try {
    const response = await axios.get(
      `${WP_API_URL}/wp/v2/attachment_category`,
      {
        params: req.query, // Passer les paramètres de requête du frontend
        auth: {
          username: WP_USERNAME,
          password: WP_PASSWORD,
        },
      }
    );
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération des catégories de médias (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération des catégories de médias",
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

// --- Endpoint pour mettre à jour les catégories d'un média WordPress ---
app.put("/api/media/:mediaId", async (req, res) => {
  const mediaId = req.params.mediaId;
  const { attachment_category } = req.body; // Récupère le tableau d'IDs de catégories

  if (!Array.isArray(attachment_category)) {
    return res
      .status(400)
      .json({
        error:
          "Le corps de la requête doit contenir un tableau 'attachment_category'.",
      });
  }

  try {
    const response = await axios.post(
      `${WP_API_URL}/wp/v2/media/${mediaId}`,
      {
        attachment_category: attachment_category,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        auth: {
          username: WP_USERNAME,
          password: WP_PASSWORD,
        },
      }
    );
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la mise à jour des catégories du média (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la mise à jour des catégories du média",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoint pour supprimer un média WordPress ---
app.delete("/api/media/:mediaId", async (req, res) => {
  const mediaId = req.params.mediaId;

  try {
    const response = await axios.delete(
      `${WP_API_URL}/wp/v2/media/${mediaId}?force=true`,
      {
        auth: {
          username: WP_USERNAME,
          password: WP_PASSWORD,
        },
      }
    );
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la suppression du média (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la suppression du média",
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

// Nouvel Endpoint pour les Variations de Produit (GET `/products/{product_id}/variations`)
app.get("/api/products/:product_id/variations", async (req, res) => {
  const productId = req.params.product_id;
  console.log(
    `Backend: Received request to fetch variations for product ID: ${productId}`
  );

  try {
    const { data } = await wooApi.get(`products/${productId}/variations`);
    console.log(
      `Backend: Successfully fetched variations for product ID: ${productId}.`
    );
    res.status(200).json(data);
  } catch (error) {
    console.error(
      `Backend: Erreur lors de la récupération des variations pour le produit ${productId}:`,
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: `Erreur lors de la récupération des variations pour le produit ${productId}`,
      details: error.response?.data || error.message,
    });
  }
});

// Nouvelle route pour récupérer les produits mis en avant (featured products)
app.get("/api/featured-product", async (req, res) => {
  console.log("Backend: Received request to fetch featured products.");
  try {
    const { data } = await wooApi.get("products", { featured: true, ...req.query });
    console.log("Backend: Successfully fetched featured products from WooCommerce API.");
    res.status(200).json(data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération des produits mis en avant:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération des produits mis en avant",
      details: error.response?.data || error.message,
    });
  }
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur backend démarré sur le port ${PORT}`);
});
