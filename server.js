require("dotenv").config();
const express = require("express");
const cors = require("cors");
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const axios = require("axios");
const multer = require("multer");
const FormData = require("form-data");
const Mailjet = require('node-mailjet');
const sharp = require('sharp');

const cache = new Map(); // Stores cached responses
const DEFAULT_TTL = 60 * 5 * 1000; // Default TTL: 5 minutes in milliseconds

function cacheMiddleware(req, res, next) {
  const key = req.originalUrl; // Use the full URL as the cache key

  if (cache.has(key)) {
    const cachedData = cache.get(key);
    if (Date.now() < cachedData.expiry) {
      console.log(`Serving from cache: ${key}`);
      return res.json(cachedData.data);
    } else {
      console.log(`Cache expired for: ${key}`);
      cache.delete(key); // Remove expired item
    }
  }

  // If not in cache or expired, proceed with the request
  res.sendResponse = res.json; // Store original json function
  res.json = (body) => {
    console.log(`Caching response for: ${key}`);
    cache.set(key, { data: body, expiry: Date.now() + DEFAULT_TTL });
    res.sendResponse(body);
  };
  next();
}

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
  "MAIL_TO_ADMIN",
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

// Mailjet setup
const mailjet = new Mailjet({
  apiKey: process.env.MAILJET_API_KEY,
  apiSecret: process.env.MAILJET_SECRET_KEY
});

// Configuration de l'API WordPress (pour les articles et médias)
const WP_API_URL = `${process.env.WOO_API_URL}/wp-json`;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_PASSWORD = process.env.WP_PASSWORD;

console.log(`WOO_API_URL: ${process.env.WOO_API_URL}`);
console.log(`WP_API_URL: ${WP_API_URL}`);

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

    const request = mailjet
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: {
              Email: process.env.MAIL_FROM,
              Name: "Titounet"
            },
            To: [
              {
                Email: orderData.billing.email,
                Name: `${orderData.billing.first_name} ${orderData.billing.last_name}`
              }
            ],
            Subject: mailOptions.subject,
            TextPart: "",
            HTMLPart: mailOptions.html
          }
        ]
      });

    request
      .then((result) => {
        console.log("Email de confirmation envoyé avec succès:", result.body);
      })
      .catch((err) => {
        console.error(
          "Erreur lors de l'envoi de l'email de confirmation en arrière-plan:",
          err.statusCode, err.message
        );
      });

    // Envoyer l'email de notification à l'administrateur
    console.log("Attempting to send admin notification email...");
    const adminMailOptions = {
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO_ADMIN,
      subject: `Nouvelle commande #${orderResponse.id}`,
      html: `
        <h1>Une nouvelle commande a été passée sur Titounet !</h1>
        <p>Commande #${orderResponse.id}</p>
        <p>Client: ${orderData.billing.first_name} ${orderData.billing.last_name} (${orderData.billing.email})</p>
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
        <p>Adresse de livraison:</p>
        <p>
          ${orderData.shipping.first_name} ${orderData.shipping.last_name}<br>
          ${orderData.shipping.address_1}<br>
          ${orderData.shipping.postcode} ${orderData.shipping.city}<br>
          ${orderData.shipping.country}
        </p>
      `,
    };

    const adminRequest = mailjet
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: {
              Email: process.env.MAIL_FROM,
              Name: "Titounet"
            },
            To: [
              {
                Email: process.env.MAIL_TO_ADMIN
              }
            ],
            Subject: adminMailOptions.subject,
            TextPart: "",
            HTMLPart: adminMailOptions.html
          }
        ]
      });

      adminRequest
      .then((result) => {
        console.log("Email de notification administrateur envoyé avec succès:", result.body);
      })
      .catch((err) => {
        console.error(
          "Erreur lors de l'envoi de l'email de notification à l'administrateur:",
          err.statusCode, err.message
        );
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

// Endpoint pour récupérer les commandes WooCommerce
app.get("/api/orders", async (req, res) => {
  console.log("Backend: Received request to fetch orders.");
  try {
    const params = { ...req.query };
    // Assurer la pagination si nécessaire
    if (params.per_page) {
      params.per_page = parseInt(params.per_page, 10);
    }
    if (params.page) {
      params.page = parseInt(params.page, 10);
    }
    const { data } = await wooApi.get("orders", params);
    console.log("Backend: Successfully fetched orders from WooCommerce.");
    res.status(200).json(data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération des commandes:",
      error.response?.data || error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération des commandes",
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

app.get("/api/products", cacheMiddleware, async (req, res) => {
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

app.get("/api/products/featured", cacheMiddleware, async (req, res) => {
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

app.get("/api/products/:id", cacheMiddleware, async (req, res) => {
  console.log("Backend: Received request to fetch single product.");
  try {
    const productId = req.params.id;
    const { data } = await wooApi.get(`products/${productId}`, req.query);
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

app.get("/api/products/:product_id/variations", cacheMiddleware, async (req, res) => {
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

app.get("/api/products/attributes/:attribute_id/terms", cacheMiddleware, async (req, res) => {
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
app.get("/api/product-categories", cacheMiddleware, async (req, res) => {
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

app.get("/api/media", cacheMiddleware, async (req, res) => {
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

app.get("/api/media/:id", cacheMiddleware, async (req, res) => {
  try {
    const mediaId = req.params.id;
    const response = await axios.get(`${WP_API_URL}/wp/v2/media/${mediaId}`, {
      params: req.query,
      auth: {
        username: WP_USERNAME,
        password: WP_PASSWORD,
      },
    });

    const mediaData = response.data;

    // Generate blurred placeholder if it's an image and has a source_url
    if (mediaData.media_details && mediaData.media_details.sizes && mediaData.media_details.sizes.full && mediaData.media_details.sizes.full.source_url) {
      try {
        const imageUrl = mediaData.media_details.sizes.full.source_url;
        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const blurredBuffer = await sharp(imageResponse.data)
          .resize(20, 20) // Tiny size
          .blur(1) // Apply a slight blur
          .jpeg({ quality: 50 }) // Compress as JPEG
          .toBuffer();
        mediaData.placeholder_url = `data:image/jpeg;base64,${blurredBuffer.toString('base64')}`;
      } catch (placeholderError) {
        console.error(`Error generating placeholder for media ${mediaId}:`, placeholderError.message);
        // Fallback: do not add placeholder_url if generation fails
      }
    }

    res.status(200).json(mediaData);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération du média (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response ? error.response.status : 500).json({
      error: "Erreur lors de la récupération du média",
      details: error.response ? error.response.data : error.message,
    });
  }
});

app.get("/api/media_category", cacheMiddleware, async (req, res) => {
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

app.get("/api/media/category/:slug", cacheMiddleware, async (req, res) => {
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
app.get("/api/articles", cacheMiddleware, async (req, res) => {
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
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération des articles",
      details: error.response ? error.response.data : error.message,
    });
  }
});

app.get("/api/articles/:id", cacheMiddleware, async (req, res) => {
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
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération de l'article",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// New Endpoint for WordPress Pages
app.get("/api/pages/:id", cacheMiddleware, async (req, res) => {
  console.log("Backend: Received request to fetch single page.");
  try {
    const pageId = req.params.id;
    const response = await axios.get(`${WP_API_URL}/wp/v2/pages/${pageId}`, {
      params: req.query,
      auth: {
        username: WP_USERNAME,
        password: WP_PASSWORD,
      },
    });
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération de la page (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération de la page",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoints Instagram ---
app.get("/api/titounet/v1/featured-instagram", cacheMiddleware, async (req, res) => {
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
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la mise à jour des posts Instagram favoris",
      details: error.response ? error.response.data : error.message,
    });
  }
});

app.get("/api/instagram/media", cacheMiddleware, async (req, res) => {
  const userId = req.query.userId;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const postIdsParam = req.query.postIds; // Get postIds from query
  const featuredIds = postIdsParam ? postIdsParam.split(',') : []; // Split into array


  if (!userId) {
    return res.status(400).json({ error: "User ID is required." });
  }

  if (!accessToken) {
    console.error("INSTAGRAM_ACCESS_TOKEN is not set in environment variables.");
    return res.status(500).json({ error: "Instagram Access Token is not configured on the server." });
  }

  const url = `https://graph.instagram.com/${userId}/media?fields=id,caption,media_type,media_url,permalink,children{id,media_type,media_url}&access_token=${accessToken}`;

  try {
    const response = await axios.get(url);
    let instagramPosts = response.data.data;

    // Filter posts based on featuredIds BEFORE processing
    if (featuredIds.length > 0) {
      instagramPosts = instagramPosts.filter(post => featuredIds.includes(post.id));
    }

    const processedPosts = await Promise.all(instagramPosts.map(async (post) => {
      if (post.media_type === 'IMAGE' && post.media_url) {
        try {
          const imageResponse = await axios.get(post.media_url, { responseType: 'arraybuffer' });
          const image = sharp(imageResponse.data);
          const metadata = await image.metadata();
          console.log(`Original image ${post.id} dimensions: ${metadata.width}x${metadata.height}`);
          const resizedImageBuffer = await image
            .resize(200, 200)
            .toBuffer();
          const resizedBase64 = `data:image/jpeg;base64,${resizedImageBuffer.toString('base64')}`;
          console.log(`Resized image ${post.id} to 200x200.`);
          return { ...post, resized_media_url: resizedBase64 };
        } catch (resizeError) {
          console.error(`Error resizing Instagram image ${post.id}:`, resizeError.message, resizeError.stack);
          return { ...post, resized_media_url: post.media_url }; // Fallback to original
        }
      } else if (post.media_type === 'CAROUSEL_ALBUM' && post.children && post.children.data) {
        const resizedChildren = await Promise.all(post.children.data.map(async (child) => {
          if (child.media_type === 'IMAGE' && child.media_url) {
            try {
              const childImageResponse = await axios.get(child.media_url, { responseType: 'arraybuffer' });
              const childImage = sharp(childImageResponse.data);
              const childMetadata = await childImage.metadata();
              console.log(`Original child image ${child.id} dimensions: ${childMetadata.width}x${childMetadata.height}`);
              const resizedChildImageBuffer = await childImage
                .resize(200, 200)
                .toBuffer();
              const resizedChildBase64 = `data:image/jpeg;base64,${resizedChildImageBuffer.toString('base64')}`;
              console.log(`Resized child image ${child.id} to 200x200.`);
              return { ...child, resized_media_url: resizedChildBase64 };
            } catch (childResizeError) {
              console.error(`Error resizing Instagram child image ${child.id}:`, childResizeError.message, childResizeError.stack);
              return { ...child, resized_media_url: child.media_url }; // Fallback to original
            }
          }
          return child; // Return original child if not an image or no media_url
        }));
        return { ...post, resized_children: resizedChildren };
      }
      return post; // Return original post if not an image or no media_url
    }));

    console.log("Processed Posts before sending:", processedPosts);
    res.status(200).json({ data: processedPosts });
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération des médias Instagram:",
      error.response ? error.response.data : error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération des médias Instagram",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Endpoints Paramètres ---
app.get("/api/settings/order-summary-note", cacheMiddleware, async (req, res) => {
  console.log("Backend: Received request to fetch order summary note.");
  try {
    const response = await axios.get(
      `${WP_API_URL}/titounet/v1/admin/options/order-summary-note`, // New custom endpoint
      {
        auth: {
          username: WP_USERNAME,
          password: WP_PASSWORD,
        },
      }
    );
    // The new PHP endpoint returns { value: '...' }, so we pass that directly
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Backend: Erreur lors de la récupération de la note de résumé de commande (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la récupération de la note de résumé de commande",
      details: error.response ? error.response.data : error.message,
    });
  }
});

app.post("/api/settings/order-summary-note", async (req, res) => {
  console.log("Backend: Received request to update order summary note.");
  const { note } = req.body; // Expecting the note in 'note' property

  if (!note) { // Check for 'note'
    return res.status(400).json({ error: "Le contenu de la note est requis." });
  }

  try {
    const response = await axios.post( // Changed to axios.post
      `${WP_API_URL}/titounet/v1/admin/options/order-summary-note`, // Correct endpoint
      { note: note }, // Send 'note' as expected by PHP endpoint
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
      "Backend: Erreur lors de la mise à jour de la note de résumé de commande (Axios):",
      error.response ? error.response.data : error.message
    );
    res.status(error.response?.status || 500).json({
      error: "Erreur lors de la mise à jour de la note de résumé de commande",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// --- Contact Form Endpoint ---
app.post("/api/contact", async (req, res) => {
  console.log("Backend: Received contact form submission.");
  const { name, email, inquiryType, subject, message } = req.body;

  if (!name || !email || !inquiryType || !subject || !message) {
    return res.status(400).json({ error: "Tous les champs sont requis." });
  }

  const mailOptions = {
    from: process.env.MAIL_FROM,
    to: process.env.MAIL_TO_ADMIN, // Send to admin email
    subject: `[Contact Titounet - ${inquiryType}] ${subject}`,
    html: `
      <h1>Nouveau message de contact</h1>
      <p><strong>Nom:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Type de demande:</strong> ${inquiryType}</p>
      <p><strong>Sujet:</strong> ${subject}</p>
      <p><strong>Message:</strong></p>
      <p>${message}</p>
    `,
  };

  // Send the response immediately, then send the email in the background
  res.status(200).json({ message: "Message envoyé avec succès." }); // <--- Send response first

  const request = mailjet
    .post('send', { version: 'v3.1' })
    .request({
      Messages: [
        {
          From: {
            Email: process.env.MAIL_FROM,
            Name: "Titounet"
          },
          To: [
            {
              Email: process.env.MAIL_TO_ADMIN
            }
          ],
          Subject: mailOptions.subject,
          TextPart: "",
          HTMLPart: mailOptions.html
        }
      ]
    });

  request
    .then((result) => {
      console.log("Backend: Email de contact envoyé avec succès:", result.body);
    })
    .catch((err) => {
      console.error(
        "Backend: Erreur lors de l'envoi de l'email de contact en arrière-plan:",
        err.statusCode, err.message
      );
    });
}); // <--- ADD THIS CLOSING BRACE

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