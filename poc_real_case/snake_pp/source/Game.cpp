#include "../header/Game.h"
#include "../header/DebugBar.h"
#include "../header/_GLOBALS.h"
#include "../header/Grid.h"
#include "../header/Snake.h"
#include <SFML/Graphics.hpp>
#include <iostream>
#include "../header/Lost.h"
#include <random>

Game::Game() : m_rng(std::random_device{}()),
               m_apples(m_rng),
               m_isFontLoaded(false)
{
  this->m_window.setVerticalSyncEnabled(true);
  this->m_background.setFillColor(COLOR_DARK_GREEN);
  this->m_background.setSize({SCREEN_WIDTH, SCREEN_HEIGHT});
  this->m_background.setPosition({0.f, 0.f});

  std::cout << "Game created" << std::endl;
}

Game::~Game()
{
  std::cout << "Game destroyed" << std::endl;
}

void Game::run()
{
  while (this->m_window.isOpen())
  {
    while (auto event = this->m_window.pollEvent())
    {
      if (event->is<sf::Event::Closed>())
      {
        this->m_window.close();
      }
      if (const auto *keyPressed = event->getIf<sf::Event::KeyPressed>())
      {
        switch (keyPressed->scancode)
        {
        case sf::Keyboard::Scancode::F5:
          this->m_window.close();
          break;
        case sf::Keyboard::Scancode::W:
        case sf::Keyboard::Scancode::A:
        case sf::Keyboard::Scancode::S:
        case sf::Keyboard::Scancode::D:
        case sf::Keyboard::Scancode::Up:
        case sf::Keyboard::Scancode::Left:
        case sf::Keyboard::Scancode::Down:
        case sf::Keyboard::Scancode::Right:
          this->m_snake.setIsMoving(true);
          this->m_snake.switchDirection(keyPressed->scancode);
          break;
        case sf::Keyboard::Scancode::R:
          this->m_lost.setIsActive(false);
          this->m_snake.make();
          break;
        case sf::Keyboard::Scancode::O:
          this->m_debugBar.switchActive();
          break;
        default:
          break;
        }
      }
      if (event->is<sf::Event::MouseButtonPressed>())
      {
        this->m_snake.switchMoving();
      }
    }

    this->m_timeSinceLastUpdate += this->m_clock.restart();
    while (this->m_timeSinceLastUpdate >= this->m_timePerFrame)
    {
      this->m_timeSinceLastUpdate -= this->m_timePerFrame;
      this->update();
    }

    this->draw();
  }
}

void Game::update()
{
  this->m_debugBar.update(this->m_timePerFrame, this->m_timeSinceLastUpdate);
  this->m_grid.update();
  this->m_snake.update(this->m_timePerFrame, this->m_timeSinceLastUpdate);
  this->m_scoreBoard.update(&this->m_snake);
  this->m_apples.update(this->m_snake, this->m_rng);
  this->m_lost.update(this->m_snake);
}

void Game::draw()
{
  this->m_window.clear();
  this->m_window.draw(this->m_background);
  this->m_grid.draw(this->m_window);
  this->m_scoreBoard.draw(this->m_window);

  // Draw apple bevore snake so il will be
  // hidden when spawn new apple by the snake
  this->m_apples.draw(this->m_window);
  this->m_snake.draw(this->m_window);
  this->m_debugBar.draw(this->m_window);
  this->m_lost.draw(this->m_window);
  this->m_window.display();
}
