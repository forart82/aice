#pragma once

#include <SFML/Graphics.hpp>
#include "DebugBar.h"
#include "Grid.h"
#include "_GLOBALS.h"
#include "Snake.h"
#include "ScoreBoard.h"
#include "Apples.h"
#include "Lost.h"

class Game
{

private:
  sf::RenderWindow m_window = sf::RenderWindow(sf::VideoMode({SCREEN_WIDTH, SCREEN_HEIGHT}), "Game");
  const sf::Time m_timePerFrame = sf::seconds(1.f / 60.f);
  sf::Time m_timeSinceLastUpdate = sf::Time::Zero;
  sf::Clock m_clock;

  bool m_isFontLoaded;

  sf::RectangleShape m_background;
  DebugBar m_debugBar;
  Grid m_grid;
  Snake m_snake;
  ScoreBoard m_scoreBoard;
  Apples m_apples;
  Lost m_lost;
  std::mt19937 m_rng; // Corrected type: std::mt19937 is a type, not a namespace

public:
  Game();
  ~Game();

  void run();
  void update();
  void draw();
};