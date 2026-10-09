#pragma once

#include <SFML/Graphics.hpp>
#include <cmath>

const int TILE_SIZE = 32;
const int SCREEN_WIDTH = 800;
const int SCREEN_HEIGHT = 608;
const int START_ZONE_WIDTH = 600;
const int START_ZONE_HEIGHT = 400;
const int SCOREBOARD_HEIGHT = 50;
const int MAX_SNAKE_SIZE = (SCREEN_WIDTH / TILE_SIZE) * (SCREEN_HEIGHT / TILE_SIZE);
const int MIN_SNAKE_SIZE = 3;
const int MAX_APPLES = 7;
const float MAX_APPLES_TIME = 20.0f;
const int TEXT_SIZE = 16;

const float GAP_SIZE = 0.5f;
const float BUTTON_HEIGHT = 20.f;
const float BUTTON_WIDTH = 80.f;

// Background
const sf::Color COLOR_BLACK = sf::Color(20, 17, 21);
// Grid
const sf::Color COLOR_DARK_GREEN = sf::Color(77, 144, 120);
// Snake
const sf::Color COLOR_GREEN = sf::Color(198, 249, 31);

// ####################################
// ### Web: https://htmlcolors.com/ ###
// ####################################
// Apples

// Size++
const sf::Color COLOR_VIOLET = sf::Color(170, 0, 255);
// Size--
const sf::Color COLOR_ROSE = sf::Color(234, 128, 252);
// Speed++
const sf::Color COLOR_MINT_GREEN = sf::Color(178, 223, 219);
// Speed--
const sf::Color COLOR_RED = sf::Color(255, 0, 0);
// Size x2
const sf::Color COLOR_ORANGE = sf::Color(255, 61, 0);
// Size /2
const sf::Color COLOR_YELLOW = sf::Color(255, 255, 0);
// Size 3
const sf::Color COLOR_CLEAR_BLUE = sf::Color(41, 182, 246);

const sf::Color COLOR_DARK_VIOLET = sf::Color(60, 27, 67);
const sf::Color COLOR_BROWN = sf::Color(76, 43, 54);
const sf::Color COLOR_CREAM = sf::Color(212, 231, 158);
