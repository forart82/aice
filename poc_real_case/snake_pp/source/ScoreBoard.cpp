#include "../header/ScoreBoard.h"
#include "../header/_GLOBALS.h"
#include <iostream>
#include <SFML/Graphics.hpp>
#include <sstream>
#include "../header/Snake.h"

ScoreBoard::ScoreBoard() : m_speedText(m_font), m_sizeText(m_font), m_scoreText(m_font), m_isFontLoaded(false)
{
  this->m_isFontLoaded = m_font.openFromFile("arial.ttf");
  if (!this->m_isFontLoaded)
  {
    throw std::runtime_error("FATAL ERROR: Could not load font 'arial.ttf' for DebugBar.");
  }

  this->m_speedText.setCharacterSize(TEXT_SIZE);
  this->m_speedText.setFillColor(COLOR_CREAM);
  this->m_speedText.setPosition({10, 5});
  this->m_speedText.setString("Speed :  0");
  this->m_speedText.setOutlineColor(COLOR_BLACK);
  this->m_speedText.setOutlineThickness(1.f);

  this->m_sizeText.setCharacterSize(TEXT_SIZE);
  this->m_sizeText.setFillColor(COLOR_CREAM);
  this->m_sizeText.setPosition({300, 5});
  this->m_sizeText.setString("Size :  0");
  this->m_sizeText.setOutlineColor(COLOR_BLACK);
  this->m_sizeText.setOutlineThickness(1.f);

  this->m_scoreText.setCharacterSize(TEXT_SIZE);
  this->m_scoreText.setFillColor(COLOR_CREAM);
  this->m_scoreText.setPosition({600, 5});
  this->m_scoreText.setString("Score :  0");
  this->m_scoreText.setOutlineColor(COLOR_BLACK);
  this->m_scoreText.setOutlineThickness(1.f);
}

ScoreBoard::~ScoreBoard()
{
}

void ScoreBoard::update(Snake *snake)
{
  // WORK HERE
  std::stringstream ssScoreText;
  ssScoreText << "Score :  " << (int)snake->getScore();
  this->m_scoreText.setString(ssScoreText.str());

  std::stringstream ssSpeedText;
  ssSpeedText << "Speed :  " << snake->getSpeedCounter() * 10;
  this->m_speedText.setString(ssSpeedText.str());

  std::stringstream ssSizeText;
  ssSizeText << "Size :  " << snake->getSize();
  this->m_sizeText.setString(ssSizeText.str());
}

void ScoreBoard::draw(sf::RenderTarget &target)
{
  target.draw(this->m_speedText);
  target.draw(this->m_sizeText);
  target.draw(this->m_scoreText);
}