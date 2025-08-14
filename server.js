require("dotenv").config();
const express = require("express");
const cors = require("cors");
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const axios = require("axios");
const multer = require("multer");
const FormData = require("form-data");
const nodemailer = require("nodemailer");

process.on("uncaughtException", (err) => {
  console.error("🚨 Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection:", reason);
});

// Vérification des variables d'environnement
const requiredEnvVars = [
  "WOO_API_URL",
  "WOO_CONSUMER_KEY",
  "WOO_CONSUMER_SECRET",
  "WP_USERNAME",
  "WP_PASSWORD",
  "MAILJET_API_KEY",
  "MAILJET_SECRET_KEY",
  "MAIL_FROM",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error(
    `Erreur: Les variables d'environnement suivantes sont manquantes: ${missingEnvVars.join(
      ", "
    )}`
  );
  console.error(
    "Veuillez créer un fichier .env à la racine du projet et y définir ces variables."
  );
  process.exit(1); // Arrête le processus si des variables sont manquantes
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration de WooCommerce API
const wooApi = new WooCommerceRestApi({
  url: process.env.WOO_API_URL,
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

// Configuration de l'API WordPress (pour les articles et médias)
const WP_API_URL = `${process.env.WOO_API_URL}/wp-json`;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_PASSWORD = process.env.WP_PASSWORD;

// Configuration de Multer pour l'upload de fichiers
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json());

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

    res.status(201).json(orderResponse);
    console.log(
      `Successfully sent 201 response for order #${orderResponse.id}.`
    );

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

// --- Authentification ---
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    res
      .status(200)
      .json({ message: "Connexion réussie", token: "fake-jwt-token" });
  } else {
    res.status(401).json({ message: "Identifiants incorrects" });
  }
});

// --- Endpoints Produits ---
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

app.get("/api/products/featured", async (req, res) => {
  console.log("Backend: Received request to fetch featured products.");
  try {
    const { data } = await wooApi.get("products", {
      featured: true,
      ...req.query,
    });
    console.log(
      "Backend: Successfully fetched featured products from WooCommerce API."
    );
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

app.delete("/api/products/:id", async (req, res) => {
  const productId = req.params.id;

  try {
    const { data } = await wooApi.delete(`products/${productId}`, {
      force: true,
    });
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

app.post("/api/products/:product_id/variations", async (req, res) => {
  const productId = req.params.product_id;
  const variationData = req.body; // Expecting variation data in the request body

  try {
    const { data } = await wooApi.post(
      `products/${productId}/variations`,
      variationData
    );
    console.log(
      `Backend: Successfully created variation for product ID: ${productId}.`
    );
    res.status(201).json(data);
  } catch (error) {
    console.error(
      `Backend: Erreur lors de la création de la variation pour le produit ${productId}:`,
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: `Erreur lors de la création de la variation pour le produit ${productId}`,
      details: error.response?.data || error.message,
    });
  }
});

app.get("/api/products/attributes/:attribute_id/terms", async (req, res) => {
  const attributeId = req.params.attribute_id;
  console.log(
    `Backend: Received request to fetch terms for attribute ID: ${attributeId}`
  );

  try {
    const { data } = await wooApi.get(`products/attributes/${attributeId}/terms`);
    console.log(
      `Backend: Successfully fetched terms for attribute ID: ${attributeId}.`
    );
    res.status(200).json(data);
  } catch (error) {
    console.error(
      `Backend: Erreur lors de la récupération des termes pour l'attribut ${attributeId}:`,
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: `Erreur lors de la récupération des termes pour l'attribut ${attributeId}`,
      details: error.response?.data || error.message,
    });
  }
});

app.delete("/api/products/:product_id/variations/:variation_id", async (req, res) => {
  const productId = req.params.product_id;
  const variationId = req.params.variation_id;
  const forceDelete = req.query.force === 'true'; // Check for force=true in query params

  try {
    const { data } = await wooApi.delete(
      `products/${productId}/variations/${variationId}`,
      { force: forceDelete }
    );
    console.log(
      `Backend: Successfully deleted variation ${variationId} for product ID: ${productId}.`
    );
    res.status(200).json(data);
  } catch (error) {
    console.error(
      `Backend: Erreur lors de la suppression de la variation ${variationId} pour le produit ${productId}:`,
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: `Erreur lors de la suppression de la variation ${variationId} pour le produit ${productId}`,
      details: error.response?.data || error.message,
    });
  }
});

// --- Endpoints Catégories ---
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

// --- Endpoints Médias ---
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

app.get("/api/media", async (req, res) => {
  try {
    const response = await axios.get(`${WP_API_URL}/wp/v2/media`, {
      params: req.query,
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

app.get("/api/media_category", async (req, res) => {
  try {
    const response = await axios.get(
      `${WP_API_URL}/wp/v2/attachment_category`,
      {
        params: req.query,
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
        attachment_category: categorySlug,
        ...req.query,
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

app.put("/api/media/:mediaId", async (req, res) => {
  const mediaId = req.params.mediaId;
  const { attachment_category } = req.body;

  if (!Array.isArray(attachment_category)) {
    return res.status(400).json({
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

// --- Endpoints Articles ---
app.get("/api/articles", async (req, res) => {
  try {
    const response = await axios.get(`${WP_API_URL}/wp/v2/posts`, {
      params: req.query,
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

app.get("/api/articles/:id", async (req, res) => {
  try {
    const articleId = req.params.id;
    const response = await axios.get(`${WP_API_URL}/wp/v2/posts/${articleId}`, {
      params: req.query,
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

// --- Endpoints Instagram ---
app.get("/api/titounet/v1/featured-instagram", async (req, res) => {
  try {
    const response = await axios.get(`${WP_API_URL}/titounet/v1/featured-instagram`, {
      params: req.query,
      auth: {
        username: WP_USERNAME,
        password: WP_PASSWORD,
      },
    });
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération des posts Instagram favoris (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération des posts Instagram favoris",
      details: error.response ? error.response.data : error.message,
    });
  }
});

app.post("/api/titounet/v1/featured-instagram", async (req, res) => {
  const { post_ids } = req.body;

  if (!Array.isArray(post_ids)) {
    return res.status(400).json({ error: "Le paramètre post_ids doit être un tableau." });
  }

  try {
    const response = await axios.post(
      `${WP_API_URL}/titounet/v1/featured-instagram`,
      { post_ids },
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
      "Backend: Erreur lors de la mise à jour des posts Instagram favoris (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la mise à jour des posts Instagram favoris",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// Démarrage du serveur
try {
  const server = app.listen(PORT, () => {
    console.log(`✅ Serveur backend démarré sur le port ${PORT}`);
  });

  server.on("close", () => {
    console.log("❌ Serveur fermé");
  });
} catch (error) {
  console.error("Erreur lors du démarrage du serveur:", error);
  process.exit(1);
}
