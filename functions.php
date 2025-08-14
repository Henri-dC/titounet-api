<?php
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);

// ====== ROUTE POUR CRÉATION DE PRODUIT ======
add_action('rest_api_init', function () {
    register_rest_route('custom/v1', '/create-product', array(
        'methods'             => 'POST',
        'callback'            => 'custom_create_product',
        'permission_callback' => '__return_true', // À sécuriser pour un usage réel
    ));
});

// ====== ROUTE POUR MISE À JOUR D’UN PRODUIT ======
add_action('rest_api_init', function () {
    register_rest_route('custom/v1', '/update-product/(?P<id>\d+)', array(
        'methods'             => 'PUT',
        'callback'            => 'custom_update_product',
        'permission_callback' => '__return_true',
    ));
});

// ====== FONCTION : CRÉATION PRODUIT ======
function custom_create_product($request)
{
    $params = $request->get_json_params();

    if (empty($params['name']) || empty($params['price'])) {
        return new WP_Error('missing_data', 'Nom et prix sont obligatoires', array('status' => 400));
    }

    $product = new WC_Product_Simple();
    $product->set_name($params['name']);
    $product->set_regular_price($params['price']);

    if (!empty($params['short_description'])) {
        $product->set_short_description($params['short_description']);
    }

    if (!empty($params['images']) && is_array($params['images']) && !empty($params['images'][0]['id'])) {
        $product->set_image_id(intval($params['images'][0]['id']));
    }

    $product_id = $product->save();

    // Gestion du champ personnalisé is_featured_product à la création (optionnel)
    if (isset($params['is_featured_product'])) {
        $is_featured = filter_var($params['is_featured_product'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($is_featured !== null) {
            update_post_meta($product_id, '_is_featured_product', $is_featured ? 1 : 0);
        }
    }

    return array(
        'success'    => true,
        'product_id' => $product_id,
    );
}

// ====== FONCTION : MISE À JOUR PRODUIT ======
function custom_update_product($request)
{
    $params = $request->get_json_params();
    $product_id = (int) $request['id'];

    $product = wc_get_product($product_id);

    if (!$product) {
        return new WP_Error('invalid_id', 'Produit introuvable', array('status' => 404));
    }

    if (!empty($params['name'])) {
        $product->set_name($params['name']);
    }

    if (!empty($params['price'])) {
        $product->set_regular_price($params['price']);
    }

    if (!empty($params['short_description'])) {
        $product->set_short_description($params['short_description']);
    }

    if (!empty($params['images']) && is_array($params['images']) && !empty($params['images'][0]['id'])) {
        $product->set_image_id(intval($params['images'][0]['id']));
    }

    $product->save();

    // Mise à jour du champ is_featured_product via post meta
    if (isset($params['is_featured_product'])) {
        $is_featured = filter_var($params['is_featured_product'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($is_featured !== null) {
            update_post_meta($product_id, '_is_featured_product', $is_featured ? 1 : 0);
        }
    }

    return array(
        'success'    => true,
        'message'    => 'Produit mis à jour',
        'product_id' => $product_id,
    );
}

// ====== AJOUT DU CHAMP PERSONNALISÉ "is_featured_product" DANS LA REST API ======
function register_featured_product_rest_field()
{
    register_rest_field(
        'product', // Type de post
        'is_featured_product', // Nom du champ dans la réponse JSON
        array(
            'get_callback'    => 'get_is_featured_product_field',
            'update_callback' => 'update_is_featured_product_field',
            'schema'          => array(
                'description' => __('Indique si le produit est un produit mis en avant.', 'textdomain'),
                'type'        => 'boolean',
                'context'     => array('view', 'edit'),
            ),
        )
    );
}
add_action('rest_api_init', 'register_featured_product_rest_field');

function get_is_featured_product_field($object, $field_name, $request)
{
    $product_id = $object['id'];
    $value = get_post_meta($product_id, '_is_featured_product', true);
    return $value === '1' || $value === 1 || $value === true;
}

function update_is_featured_product_field($value, $object, $field_name)
{
    if (!is_bool($value)) {
        return new WP_Error(
            'rest_invalid_param',
            sprintf(__('%s doit être un booléen.', 'textdomain'), $field_name),
            array('status' => 400)
        );
    }

    $product_id = $object->ID;

    update_post_meta($product_id, '_is_featured_product', $value ? 1 : 0);

    return true;
}

// ====== ROUTE CUSTOM POUR RÉCUPÉRER LE PRODUIT MIS EN AVANT ======
add_action('rest_api_init', function () {
    register_rest_route('custom/v1', '/featured-product', array(
        'methods'  => 'GET',
        'callback' => 'get_featured_product',
        'permission_callback' => '__return_true',
    ));
});

function get_featured_product()
{
    global $wpdb;

    // Recherche un produit avec _is_featured_product = 1 dans wp_postmeta
    $product_id = $wpdb->get_var("
        SELECT post_id FROM {$wpdb->postmeta} 
        WHERE meta_key = '_is_featured_product' 
          AND meta_value = '1' 
        LIMIT 1
    ");

    if ($product_id) {
        return ['product_id' => (int) $product_id];
    }

    return new WP_Error('no_featured', 'Aucun produit coup de cœur trouvé', ['status' => 404]);
}

// Créer un point d'API pour gérer les posts Instagram favoris     
add_action('rest_api_init', function () {
    // Route pour récupérer les posts favoris
    register_rest_route('titounet/v1', '/featured-instagram', array(
        'methods' => 'GET',
        'callback' => 'get_featured_instagram_posts',
        'permission_callback' => '__return_true' // Publicly accessible
    ));

    // Route pour mettre à jour les posts favoris (protégée)
    register_rest_route('titounet/v1', '/featured-instagram', array(
        'methods' => 'POST',
        'callback' => 'update_featured_instagram_posts',
        'permission_callback' => function () {
            // Seuls les utilisateurs connectés avec la capacité d'éditer des pages peuvent accéder
            return current_user_can('edit_pages');
        }
    ));
});

// Fonction pour récupérer la liste des IDs de post
function get_featured_instagram_posts()
{
    $post_ids = get_option('featured_instagram_posts', array());
    return new WP_REST_Response($post_ids, 200);
}

// Fonction pour sauvegarder la liste des IDs de post
function update_featured_instagram_posts($request)
{
    $post_ids = $request->get_param('post_ids');
    if (!is_array($post_ids)) {
        return new WP_Error('invalid_param', 'Le paramètre post_ids doit être un tableau.', array('status' => 400));
    }

    // Sanitize the array to ensure all values are strings (IDs)
    $sanitized_post_ids = array_map('sanitize_text_field', $post_ids);

    update_option('featured_instagram_posts', $sanitized_post_ids);

    return new WP_REST_Response(array('status' => 'success', 'post_ids' => $sanitized_post_ids), 200);
}
